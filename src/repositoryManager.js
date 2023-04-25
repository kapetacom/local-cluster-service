const ClusterConfiguration = require("@kapeta/local-cluster-config");
const FS = require("node:fs");
const FSExtra = require("fs-extra");
const Path = require("node:path");
const socketManager = require("./socketManager");
const {Actions, RegistryService, Config} = require("@kapeta/nodejs-registry-utils");
const progressListener = require("./progressListener");
const os = require("os");
const {parseKapetaUri} = require("@kapeta/nodejs-utils");
const INSTALL_ATTEMPTED = {};

class RepositoryManager {

    constructor() {
        this.watcher = null;
        this.changeEventsEnabled = true;
        this.listenForChanges();
        this._registryService = new RegistryService(
            Config.data.registry.url
        );
        this._cache = {};
        this._installQueue = [];
    }

    setChangeEventsEnabled(enabled) {
        this.changeEventsEnabled = enabled;
    }

    listenForChanges() {
        const baseDir = ClusterConfiguration.getRepositoryBasedir();
        if (!FS.existsSync(baseDir)) {
            FSExtra.mkdirpSync(baseDir);
        }

        let allDefinitions = ClusterConfiguration
            .getDefinitions();

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
            const [handle, name, version] = filename.split(/\//g);
            if (!name || !version) {
                return;
            }

            if (!this.changeEventsEnabled) {
                return;
            }

            const ymlPath = Path.join(baseDir, handle, name, version, 'kapeta.yml');
            const newDefinitions = ClusterConfiguration.getDefinitions();

            const newDefinition = newDefinitions.find(d => d.ymlPath === ymlPath);
            let currentDefinition = allDefinitions.find(d => d.ymlPath === ymlPath);
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

            const payload = {type, definition: currentDefinition?.definition, asset: {handle, name, version} };

            allDefinitions = newDefinitions
            socketManager.emit(`assets`, 'changed', payload);
        });
    }

    stopListening() {
        this.watcher.close();
        this.watcher = null;
    }

    /**
     *
     * @param {string[]} refs
     * @return {Promise<void>}
     * @private
     */
    async _install(refs) {
        //We make sure to only install one asset at a time - otherwise unexpected things might happen
        const out = new Promise((resolve, reject) => {
            this._installQueue.push(async () => {
                try {
                    const normalizedRefs = refs.map(ref => parseKapetaUri(ref).id)
                    const filteredRefs = normalizedRefs.filter(ref => !INSTALL_ATTEMPTED[ref]);
                    if (filteredRefs.length > 0) {
                        filteredRefs.forEach(ref => INSTALL_ATTEMPTED[ref] = true);
                        //Auto-install missing asset
                        try {
                            //We change to a temp dir to avoid issues with the current working directory
                            process.chdir(os.tmpdir());
                            //Disable change events while installing
                            console.log('Started installing assets');
                            this.setChangeEventsEnabled(false);
                            socketManager.emit(`install`, 'install:action', {type: 'start', refs});
                            await Actions.install(progressListener, normalizedRefs, {});
                            socketManager.emit(`install`, 'install:action', {type: 'done', refs});
                        } catch (e) {
                            socketManager.emit(`install`, 'install:action', {type: 'failed', refs, error: e.message});
                        } finally {
                            console.log('Finished installing assets');
                            this.setChangeEventsEnabled(true);
                        }
                    }
                    resolve();
                } catch (e) {
                    reject(e);
                } finally {
                    this._processNext().catch(e => console.error(e));
                }
            })
        });

        this._processNext().catch(e => console.error(e));

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

                await item();
            }
        } finally {
            this._processing = false;
        }
    }

    async ensureAsset(handle, name, version) {
        const fullName = `${handle}/${name}`;
        const ref = `${fullName}:${version}`;

        if (version === 'local') {
            //TODO: Get dependencies for local asset
            return null;
        }

        const installedAsset = ClusterConfiguration.getDefinitions().find(d =>
                        d.definition.metadata.name === fullName &&
                        d.version === version);


        if (installedAsset && this._cache[ref] === true) {
            return;
        }

        if (!installedAsset && this._cache[ref] === false) {
            return;
        }

        const assetVersion = await this._registryService.getVersion(fullName, version);
        if (!assetVersion) {
            this._cache[ref] = false;
            return;
        }

        this._cache[ref] = true;
        if (!installedAsset) {
            await this._install([ref]);
        } else {
            //Ensure dependencies are installed
            const refs = assetVersion.dependencies.map((dep) => dep.name);
            await this._install(refs);
        }


    }
}

module.exports = new RepositoryManager();