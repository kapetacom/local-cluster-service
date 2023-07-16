import FS from 'node:fs';
import os from 'node:os';
import Path from 'node:path';
import FSExtra, { FSWatcher } from 'fs-extra';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { socketManager } from './socketManager';
import { progressListener } from './progressListener';
import { Dependency } from '@kapeta/schemas';
import { Actions, Config, RegistryService } from '@kapeta/nodejs-registry-utils';

const INSTALL_ATTEMPTED: { [p: string]: boolean } = {};

class RepositoryManager {
    private changeEventsEnabled: boolean;
    private _registryService: RegistryService;
    private _cache: { [key: string]: boolean };
    private watcher?: FSWatcher;
    private _installQueue: (() => Promise<void>)[];
    private _processing: boolean = false;
    constructor() {
        this.changeEventsEnabled = true;
        this.listenForChanges();
        this._registryService = new RegistryService(Config.data.registry.url);
        this._cache = {};
        this._installQueue = [];
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
            this.watcher = FS.watch(baseDir, { recursive: true });
        } catch (e) {
            // Fallback to run without watch mode due to potential platform issues.
            // https://nodejs.org/docs/latest/api/fs.html#caveats
            console.log('Unable to watch for changes. Changes to assets will not update automatically.');
            return;
        }
        this.watcher.on('change', (eventType, filename) => {
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
        });
    }

    stopListening() {
        if (!this.watcher) {
            return;
        }
        this.watcher.close();
        this.watcher = undefined;
    }

    private async _install(refs: string[]): Promise<void> {
        //We make sure to only install one asset at a time - otherwise unexpected things might happen
        const out = new Promise<void>((resolve, reject) => {
            this._installQueue.push(async () => {
                try {
                    const normalizedRefs = refs.map((ref) => parseKapetaUri(ref).id);
                    const filteredRefs = normalizedRefs.filter((ref) => !INSTALL_ATTEMPTED[ref]);
                    console.log(filteredRefs);
                    if (filteredRefs.length > 0) {
                        filteredRefs.forEach((ref) => (INSTALL_ATTEMPTED[ref] = true));
                        //Auto-install missing asset
                        try {
                            //We change to a temp dir to avoid issues with the current working directory
                            process.chdir(os.tmpdir());
                            //Disable change events while installing
                            this.setChangeEventsEnabled(false);
                            socketManager.emit(`install`, 'install:action', {
                                type: 'start',
                                refs,
                            });
                            await Actions.install(progressListener, normalizedRefs, {});
                            socketManager.emit(`install`, 'install:action', {
                                type: 'done',
                                refs,
                            });
                        } catch (e: any) {
                            socketManager.emit(`install`, 'install:action', {
                                type: 'failed',
                                refs,
                                error: e.message,
                            });
                        } finally {
                            this.setChangeEventsEnabled(true);
                        }
                    }
                    resolve();
                } catch (e) {
                    reject(e);
                } finally {
                    this._processNext().catch((e) => console.error(e));
                }
            });
        });

        this._processNext().catch((e) => console.error(e));

        return out;
    }

    async _processNext() {
        if (this._processing) {
            return;
        }
        this._processing = true;
        try {
            while (this._installQueue.length > 0) {
                const item = this._installQueue.shift();
                if (item) {
                    await item();
                }
            }
        } finally {
            this._processing = false;
        }
    }

    async ensureAsset(handle: string, name: string, version: string) {
        const fullName = `${handle}/${name}`;
        const ref = `${fullName}:${version}`;

        if (version === 'local') {
            //TODO: Get dependencies for local asset
            return;
        }

        const definitions = ClusterConfiguration.getDefinitions();
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
        if (!installedAsset) {
            console.log(`Auto-installing missing asset: ${ref}`);
            await this._install([ref]);
        } else {
            //Ensure dependencies are installed
            const refs = assetVersion.dependencies.map((dep: Dependency) => dep.name);
            console.log(`Auto-installing dependencies: ${refs.join(', ')}`);
            await this._install(refs);
        }
    }
}

export const repositoryManager = new RepositoryManager();
