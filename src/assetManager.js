const Path = require("node:path");
const FS = require('node:fs');
const FSExtra = require('fs-extra');
const YAML = require('yaml');
const ClusterConfiguration = require('@kapeta/local-cluster-config');
const codeGeneratorManager = require('./codeGeneratorManager');
const socketManager = require('./socketManager');

function makeSymLink(directory, versionTarget) {
    FSExtra.mkdirpSync(Path.dirname(versionTarget));
    FSExtra.createSymlinkSync(directory, versionTarget);
}

function enrichAsset(asset) {
    return {
        ref: `kapeta://${asset.definition.metadata.name}:${asset.version}`,
        editable: asset.version === 'local', //Only local versions are editable
        exists: true,
        version: asset.version,
        kind: asset.definition.kind,
        data: asset.definition,
        path: asset.path,
        ymlPath: asset.ymlPath
    }
}

function compareRefs(a, b) {
    const [aProtocol, aId] = parseRef(a);
    const [bProtocol, bId] = parseRef(b);

    return aProtocol === bProtocol && aId === bId;
}
function parseRef(ref) {
    let out = ref.split(/:\/\//,2);

    if (out.length === 1) {
        return [
            'kapeta',
            ref.toLowerCase()
        ]
    }
    return [
        out[0].toLowerCase(),
        out[1].toLowerCase()
    ];
}

class AssetManager {

    constructor() {
        this.watcher = null;
        this.listenForChanges();
    }

    listenForChanges() {
        const baseDir = ClusterConfiguration.getRepositoryBasedir();
        if (!FS.existsSync(baseDir)) {
            FSExtra.mkdirpSync(baseDir);
        }

        let currentWebDefinitions = ClusterConfiguration
            .getProviderDefinitions()
            .filter(d => d.hasWeb);

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

            const ymlPath = Path.join(baseDir, handle, name, version, 'kapeta.yml');
            const newWebDefinitions = ClusterConfiguration
                .getProviderDefinitions()
                .filter(d => d.hasWeb);

            const newWebDefinition = newWebDefinitions.find(d => d.ymlPath === ymlPath);
            let currentWebDefinition = currentWebDefinitions.find(d => d.ymlPath === ymlPath);
            const ymlExists = FS.existsSync(ymlPath);
            let type;
            if (ymlExists) {
                if (currentWebDefinition) {
                    type = 'updated';
                } else if (newWebDefinition) {
                    type = 'added';
                    currentWebDefinition = newWebDefinition;
                } else {
                    //Other definition was added / updated - ignore
                    return;
                }
            } else {
                if (currentWebDefinition) {
                    //Something was removed
                    type = 'removed';
                } else {
                    //Other definition was removed - ignore
                    return;
                }
            }

            const payload = {type, definition: currentWebDefinition?.definition, asset: {handle, name, version} };

            currentWebDefinitions = newWebDefinitions

            socketManager.emit(`assets`, 'changed', payload);
        });
    }

    stopListening() {
        this.watcher.close();
        this.watcher = null;
    }


    /**
     *
     * @param {string[]} [assetKinds]
     * @returns {{path: *, ref: string, data: *, editable: boolean, kind: *, exists: boolean}[]}
     */
    getAssets(assetKinds) {
        if (!assetKinds) {
            const blockTypeProviders = ClusterConfiguration.getDefinitions('core/block-type');
            assetKinds = blockTypeProviders.map(p => {
                return `${p.definition.metadata.name}:${p.version}`
            });
            assetKinds.push('core/plan');
        }

        const assets = ClusterConfiguration.getDefinitions(assetKinds);

        return assets.map(enrichAsset);
    }

    getPlans() {
        return this.getAssets(['core/plan']);
    }

    getPlan(ref) {
        const asset = this.getAsset(ref);

        if ('core/plan' !== asset.kind) {
            throw new Error('Asset was not a plan: ' + ref);
        }

        return asset.data;
    }

    getAsset(ref) {
        const asset = ClusterConfiguration.getDefinitions()
            .map(enrichAsset)
            .find(a => compareRefs(a.ref,ref));
        if (!asset) {
            throw new Error('Asset not found: ' + ref);
        }

        return asset;
    }

    async createAsset(path, yaml) {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
        }

        const dirName = Path.dirname(path);
        if (!FS.existsSync(dirName)) {
            FSExtra.mkdirpSync(dirName);
        }

        FS.writeFileSync(path, YAML.stringify(yaml));

        const asset = await this.importFile(path);

        if (codeGeneratorManager.canGenerateCode(yaml)) {
            await codeGeneratorManager.generate(path, yaml);
        }

        return asset;
    }

    async updateAsset(ref, yaml) {
        const asset = this.getAsset(ref);
        if (!asset) {
            throw new Error('Attempted to update unknown asset: ' + ref);
        }

        if (!asset.editable) {
            throw new Error('Attempted to update read-only asset: ' + ref);
        }

        if (!asset.ymlPath) {
            throw new Error('Attempted to update corrupted asset: ' + ref);
        }

        FS.writeFileSync(asset.ymlPath, YAML.stringify(yaml));

        if (codeGeneratorManager.canGenerateCode(yaml)) {
            await codeGeneratorManager.generate(asset.ymlPath, yaml);
        } else {
            console.log('Could not generate code for %s', yaml.kind ? yaml.kind : 'unknown yaml');
        }
    }

    hasAsset(ref) {
        return !!this.getAsset(ref);
    }

    async importFile(filePath) {
        if (filePath.startsWith('file://')) {
            filePath = filePath.substring('file://'.length);
        }

        if (!FS.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }

        const assetInfos = YAML.parseAllDocuments(FS.readFileSync(filePath).toString())
            .map(doc => doc.toJSON());

        const assetInfo = assetInfos[0];
        const version = 'local';
        const [handle, name] = assetInfo.metadata.name.split('/');

        const target = ClusterConfiguration.getRepositoryAssetPath(handle, name, version);
        if (!FS.existsSync(target)) {
            makeSymLink(Path.dirname(filePath), target);
        }

        const refs = assetInfos.map(assetInfo => `kapeta://${assetInfo.metadata.name}:${version}`);

        return this.getAssets().filter(a => refs.some(ref => compareRefs(ref, a.ref)));
    }

    unregisterAsset(ref) {
        const asset = this.getAsset(ref);
        if (!asset) {
            throw new Error('Asset does not exists: ' + ref);
        }
        //Remove from repository. If its local it is just a symlink - so no unchecked code is removed.
        FSExtra.removeSync(asset.path);
    }
}

module.exports = new AssetManager();
