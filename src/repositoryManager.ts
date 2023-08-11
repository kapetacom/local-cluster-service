import os from 'node:os';
import { socketManager } from './socketManager';
import { Dependency } from '@kapeta/schemas';
import { Actions, Config, RegistryService } from '@kapeta/nodejs-registry-utils';
import { definitionsManager } from './definitionsManager';
import { Task, taskManager } from './taskManager';
import { normalizeKapetaUri } from './utils/utils';

import { ProgressListener } from './progressListener';
import { RepositoryWatcher } from './RepositoryWatcher';
import { assetManager } from './assetManager';

function clearAllCaches() {
    definitionsManager.clearCache();
    assetManager.clearCache();
}

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
    'kapeta/language-target-react-ts',
    'kapeta/language-target-nodejs',
    'kapeta/language-target-java-spring-boot',
];

const INSTALL_ATTEMPTED: { [p: string]: boolean } = {};

class RepositoryManager {
    private _registryService: RegistryService;
    private _cache: { [key: string]: boolean };
    private watcher: RepositoryWatcher;

    constructor() {
        this._registryService = new RegistryService(Config.data.registry.url);
        this._cache = {};
        this.watcher = new RepositoryWatcher();
        this.listenForChanges();
    }

    listenForChanges() {
        this.watcher.watch();
    }

    async stopListening() {
        return this.watcher.unwatch();
    }

    ignoreChangesFor(file: string) {
        return this.watcher.ignoreChangesFor(file);
    }

    resumeChangedFor(file: string) {
        return this.watcher.resumeChangedFor(file);
    }

    public ensureDefaultProviders(): void {
        socketManager.emitGlobal(EVENT_DEFAULT_PROVIDERS_START, { providers: DEFAULT_PROVIDERS });
        const tasks = this._install(DEFAULT_PROVIDERS);
        Promise.allSettled(tasks.map((t) => t.wait())).then(() => {
            socketManager.emitGlobal(EVENT_DEFAULT_PROVIDERS_END, {});
        });
    }

    private _install(refs: string[]): Task[] {
        //We make sure to only install one asset at a time - otherwise unexpected things might happen
        const createInstaller = (ref: string) => {
            return async () => {
                if (INSTALL_ATTEMPTED[ref]) {
                    return;
                }

                if (definitionsManager.exists(ref)) {
                    return;
                }
                //console.log(`Installing asset: ${ref}`);
                INSTALL_ATTEMPTED[ref] = true;
                //Auto-install missing asset
                try {
                    //We change to a temp dir to avoid issues with the current working directory
                    process.chdir(os.tmpdir());
                    await Actions.install(new ProgressListener(), [ref], {});
                } catch (e) {
                    console.error(`Failed to install asset: ${ref}`, e);
                    throw e;
                }
                clearAllCaches();
                //console.log(`Asset installed: ${ref}`);
            };
        };

        const tasks: Task[] = [];

        while (refs.length > 0) {
            let ref = refs.shift();
            if (!ref) {
                continue;
            }
            ref = normalizeKapetaUri(ref);

            if (INSTALL_ATTEMPTED[ref]) {
                continue;
            }

            if (definitionsManager.exists(ref)) {
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

        const definitions = definitionsManager.getDefinitions();
        const installedAsset = definitions.find(
            (d) => d.definition.metadata.name === fullName && d.version === version
        );

        if (installedAsset && this._cache[ref] === true) {
            return;
        }

        if (!installedAsset && this._cache[ref] === false) {
            return;
        }

        let assetVersion;
        try {
            assetVersion = await this._registryService.getVersion(fullName, version);
            if (!assetVersion) {
                this._cache[ref] = false;
                return;
            }
        } catch (e) {
            console.warn(`Unable to resolve asset: ${ref}`, e);
            if (installedAsset) {
                return;
            }
            throw e;
        }

        this._cache[ref] = true;
        let tasks: Task[] | undefined = undefined;
        if (!installedAsset) {
            tasks = this._install([ref]);
        } else {
            //Ensure dependencies are installed
            const refs = assetVersion.dependencies.map((dep: Dependency) => dep.name);
            if (refs.length > 0) {
                tasks = this._install(refs);
            }
        }

        if (tasks && wait) {
            await Promise.all(tasks.map((t) => t.wait()));
        }

        return tasks;
    }
}

export const repositoryManager = new RepositoryManager();
