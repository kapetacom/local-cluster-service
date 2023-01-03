const Path = require("node:path");
const FS = require('node:fs');
const FSExtra = require('fs-extra');
const YAML = require('yaml');
const ClusterConfiguration = require('@blockware/local-cluster-config');
const codeGeneratorManager = require('./codeGeneratorManager');

function makeSymLink(directory, versionTarget) {
    FSExtra.mkdirpSync(Path.dirname(versionTarget));
    FSExtra.createSymlinkSync(directory, versionTarget);
}

function enrichAsset(asset) {
    return {
        ref: `blockware://${asset.definition.metadata.name}:${asset.version}`,
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
            'blockware',
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

    }


    /**
     *
     * @param {string[]} [assetKinds]
     * @returns {{path: *, ref: string, data: *, editable: boolean, kind: *, exists: boolean}[]}
     */
    getAssets(assetKinds) {
        const blockTypeProviders = ClusterConfiguration.getDefinitions('core/block-type');

        if (!assetKinds) {
            assetKinds = blockTypeProviders.map(p => {
                return `${p.definition.metadata.name}:${p.version}`
            });
            assetKinds.push('core/plan');
        }

        console.log('assetKinds', assetKinds);

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
        const asset = this.getAssets().find(a => compareRefs(a.ref,ref));
        if (!asset) {
            throw new Error('Asset not found: ' + ref);
        }

        return asset;
    }

    async createAsset(path, yaml) {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
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

        if (!FS.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }

        const refs = [];

        const blockInfos = YAML.parseAllDocuments(FS.readFileSync(filePath).toString())
            .map(doc => doc.toJSON());

        blockInfos.forEach(blockInfo => {
            const version = 'local';
            const [handle, name] = blockInfo.metadata.name.split('/');

            const target = ClusterConfiguration.getRepositoryAssetPath(handle, name, version);
            if (!FS.existsSync(target)) {
                makeSymLink(Path.dirname(filePath), target);
                refs.push(`blockware://${blockInfo.metadata.name}:${version}`);
            }
        });

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