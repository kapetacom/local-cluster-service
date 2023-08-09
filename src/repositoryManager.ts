import FS from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import watch from 'recursive-watch';
import FSExtra from 'fs-extra';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { socketManager } from './socketManager';
import { progressListener } from './progressListener';
import { Dependency } from '@kapeta/schemas';
import { Actions, Config, RegistryService } from '@kapeta/nodejs-registry-utils';
import { definitionsManager } from './definitionsManager';
import { Task, taskManager } from './taskManager';
import { normalizeKapetaUri } from './utils/utils';
import { assetManager } from './assetManager';

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
    private changeEventsEnabled: boolean;
    private _registryService: RegistryService;
    private _cache: { [key: string]: boolean };
    private watcher?: () => void;

    constructor() {
        this.changeEventsEnabled = true;
        this.listenForChanges();
        this._registryService = new RegistryService(Config.data.registry.url);
        this._cache = {};
    }

    setChangeEventsEnabled(enabled: boolean) {
        this.changeEventsEnabled = enabled;
    }

    listenForChanges() {
        const baseDir = ClusterConfiguration.getRepositoryBasedir();
        if (!FS.existsSync(baseDir)) {
            FSExtra.mkdirpSync(baseDir);
        }

        let allDefinitions = ClusterConfiguration.getDefinitions();

        console.log('Watching local repository for provider changes: %s', baseDir);
        try {
            this.watcher = watch(baseDir, (filename: string) => {
                if (!filename) {
                    return;
                }

                const [handle, name, version] = filename.toString().split(/\//g);
                if (!name || !version) {
                    return;
                }

                if (!this.changeEventsEnabled) {
                    return;
                }

                const ymlPath = Path.join(baseDir, handle, name, version, 'kapeta.yml');
                const newDefinitions = ClusterConfiguration.getDefinitions();

                const newDefinition = newDefinitions.find((d) => d.ymlPath === ymlPath);
                let currentDefinition = allDefinitions.find((d) => d.ymlPath === ymlPath);
                const ymlExists = FS.existsSync(ymlPath);
                let type;
                if (ymlExists) {
                    if (currentDefinition) {
                        type = 'updated';
                    } else if (newDefinition) {
                        type = 'added';
                        currentDefinition = newDefinition;
                    } else {
                        //Other definition was added / updated - ignore
                        return;
                    }
                } else {
                    if (currentDefinition) {
                        const ref = parseKapetaUri(
                            `${currentDefinition.definition.metadata.name}:${currentDefinition.version}`
                        ).id;
                        delete INSTALL_ATTEMPTED[ref];
                        //Something was removed
                        type = 'removed';
                    } else {
                        //Other definition was removed - ignore
                        return;
                    }
                }

                const payload = {
                    type,
                    definition: currentDefinition?.definition,
                    asset: { handle, name, version },
                };

                allDefinitions = newDefinitions;
                socketManager.emit(`assets`, 'changed', payload);
                definitionsManager.clearCache();
            });
        } catch (e) {
            // Fallback to run without watch mode due to potential platform issues.
            // https://nodejs.org/docs/latest/api/fs.html#caveats
            console.log('Unable to watch for changes. Changes to assets will not update automatically.', e);
            return;
        }
    }

    stopListening() {
        if (!this.watcher) {
            return;
        }
        this.watcher();
        this.watcher = undefined;
    }

    public ensureDefaultProviders(): void {
        this._install(DEFAULT_PROVIDERS);
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
                    //Disable change events while installing
                    this.setChangeEventsEnabled(false);
                    await Actions.install(progressListener, [ref], {});
                } catch (e) {
                    console.error(`Failed to install asset: ${ref}`, e);
                    throw e;
                } finally {
                    this.setChangeEventsEnabled(true);
                }
                definitionsManager.clearCache();
                assetManager.clearCache();
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
