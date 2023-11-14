/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import os from 'node:os';
import { socketManager } from './socketManager';
import { Dependency } from '@kapeta/schemas';
import { Actions, AssetVersion, Config, RegistryService } from '@kapeta/nodejs-registry-utils';
import { definitionsManager } from './definitionsManager';
import { Task, taskManager } from './taskManager';
import { normalizeKapetaUri } from '@kapeta/nodejs-utils';
import { ProgressListener } from './progressListener';
import { RepositoryWatcher } from './RepositoryWatcher';
import { SourceOfChange } from './types';
import { cacheManager } from './cacheManager';
import { EventEmitter } from 'node:events';
import { DefinitionInfo } from '@kapeta/local-cluster-config';

const EVENT_DEFAULT_PROVIDERS_START = 'default-providers-start';
const EVENT_DEFAULT_PROVIDERS_END = 'default-providers-end';

const DEFAULT_PROVIDERS = [
    'kapeta/block-type-service',
    'kapeta/block-type-frontend',
    'kapeta/block-type-gateway-http',
    'kapeta/resource-type-rest-api',
    'kapeta/resource-type-rest-client',
    'kapeta/resource-type-web-page',
    'kapeta/resource-type-web-fragment',
    'kapeta/resource-type-mongodb',
    'kapeta/resource-type-postgresql',
    'kapeta/resource-type-smtp-client',
    'kapeta/language-target-react-ts',
    'kapeta/language-target-nodejs',
];

class RepositoryManager extends EventEmitter {
    private _registryService: RegistryService;
    private watcher: RepositoryWatcher;

    constructor() {
        super();
        this._registryService = new RegistryService(Config.data.registry.url);
        this.watcher = new RepositoryWatcher();
        this.listenForChanges();

        this.watcher.on('change', (file: string, source: SourceOfChange) => {
            this.emit('change', file, source);
        });
    }

    listenForChanges() {
        this.watcher.watch();
    }

    async stopListening() {
        return this.watcher.unwatch();
    }

    /**
     * Setting the source of change helps us know
     * how to react to changes in the UI.
     */
    setSourceOfChangeFor(file: string, source: SourceOfChange) {
        return this.watcher.setSourceOfChangeFor(file, source);
    }

    clearSourceOfChangeFor(file: string) {
        return this.watcher.clearSourceOfChangeFor(file);
    }

    public async ensureDefaultProviders(): Promise<void> {
        socketManager.emitGlobal(EVENT_DEFAULT_PROVIDERS_START, { providers: DEFAULT_PROVIDERS });
        const tasks = await this.scheduleInstallation(DEFAULT_PROVIDERS);
        Promise.allSettled(tasks.map((t) => t.wait())).then(() => {
            socketManager.emitGlobal(EVENT_DEFAULT_PROVIDERS_END, {});
        });
    }

    public async scheduleUpdate(allNames: string[]): Promise<Task | undefined> {
        const names = Array.from(new Set<string>(allNames));

        const currentVersions = await Promise.all(
            names.map((name) => definitionsManager.getLatestDefinition(name).catch(() => undefined))
        );

        const latestVersions = await Promise.all(
            names.map((name) => this._registryService.getLatestVersion(name).catch(() => undefined))
        );

        const refs = names
            .map((name, index) => {
                const currentVersion: DefinitionInfo | undefined = currentVersions[index];
                const latestVersion: AssetVersion | undefined = latestVersions[index];
                if (!currentVersion || !latestVersion) {
                    // Shouldn't happen unless the registry is down or an asset was deleted
                    return undefined;
                }

                const ref = normalizeKapetaUri(`${name}:${latestVersion.version}`);

                if (currentVersion.version === latestVersion.version) {
                    return undefined;
                }

                return ref;
            })
            .filter((ref) => !!ref) as string[];

        if (refs.length < 1) {
            console.log('No updates found');
            return undefined;
        }

        console.log('Installing updates', refs);
        const updateAll = async () => {
            try {
                //We change to a temp dir to avoid issues with the current working directory
                process.chdir(os.tmpdir());
                await Actions.install(new ProgressListener(), refs, {});
            } catch (e) {
                console.error(`Failed to update assets: ${refs.join(',')}`, e);
                throw e;
            }
            cacheManager.flush();
            definitionsManager.clearCache();
        };

        return taskManager.add(`asset:update`, updateAll, {
            name: `Installing ${refs.length} updates`,
            group: 'asset:update:check',
        });
    }

    private async scheduleInstallation(refs: string[]): Promise<Task[]> {
        //We make sure to only install one asset at a time - otherwise unexpected things might happen
        const createInstaller = (ref: string) => {
            return async () => {
                if (await definitionsManager.exists(ref)) {
                    return;
                }
                //console.log(`Installing asset: ${ref}`);
                //Auto-install missing asset
                try {
                    //We change to a temp dir to avoid issues with the current working directory
                    process.chdir(os.tmpdir());
                    await Actions.install(new ProgressListener(), [ref], {});
                } catch (e) {
                    console.error(`Failed to install asset: ${ref}`, e);
                    throw e;
                }
                cacheManager.flush();
                if (await definitionsManager.exists(ref)) {
                    return;
                }
                throw new Error(`Failed to install asset: ${ref}`);
            };
        };

        const tasks: Task[] = [];

        while (refs.length > 0) {
            let ref = refs.shift();
            if (!ref) {
                continue;
            }
            ref = normalizeKapetaUri(ref);

            if (await definitionsManager.exists(ref)) {
                continue;
            }

            const task = taskManager.add(`asset:install:${ref}`, createInstaller(ref), {
                name: `Installing ${ref}`,
                group: 'asset:install:', //Group prevents multiple tasks from running at the same time
            });

            tasks.push(task);
        }

        return tasks;
    }

    async ensureAsset(
        handle: string,
        name: string,
        version: string,
        wait: boolean = true
    ): Promise<undefined | Task[]> {
        const fullName = `${handle}/${name}`;
        const ref = `${fullName}:${version}`;

        if (version === 'local') {
            //TODO: Get dependencies for local asset
            return;
        }

        const installedAsset = await definitionsManager.getDefinition(`${fullName}:${version}`);

        let assetVersion;
        try {
            assetVersion = await this._registryService.getVersion(fullName, version);
            if (!assetVersion) {
                return;
            }
        } catch (e) {
            console.warn(`Unable to resolve asset: ${ref}`, e);
            if (installedAsset) {
                return;
            }
            throw e;
        }

        let tasks: Task[] | undefined = undefined;
        if (!installedAsset) {
            tasks = await this.scheduleInstallation([ref]);
        } else {
            //Ensure dependencies are installed
            const refs = assetVersion.dependencies.map((dep: Dependency) => dep.name);
            if (refs.length > 0) {
                tasks = await this.scheduleInstallation(refs);
            }
        }

        if (tasks && wait) {
            await Promise.all(tasks.map((t) => t.wait()));
        }

        return tasks;
    }
}

export const repositoryManager = new RepositoryManager();
