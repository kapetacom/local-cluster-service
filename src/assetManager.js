const Path = require('node:path');
const FS = require('node:fs');
const FSExtra = require('fs-extra');
const YAML = require('yaml');
const ClusterConfiguration = require('@kapeta/local-cluster-config').default;
const { Actions } = require('@kapeta/nodejs-registry-utils');
const codeGeneratorManager = require('./codeGeneratorManager');
const progressListener = require('./progressListener');
const { parseKapetaUri } = require('@kapeta/nodejs-utils');
const repositoryManager = require('./repositoryManager');
const NodeCache = require('node-cache');

function enrichAsset(asset) {
    return {
        ref: `kapeta://${asset.definition.metadata.name}:${asset.version}`,
        editable: asset.version === 'local', //Only local versions are editable
        exists: true,
        version: asset.version,
        kind: asset.definition.kind,
        data: asset.definition,
        path: asset.path,
        ymlPath: asset.ymlPath,
    };
}

function compareRefs(a, b) {
    const [aProtocol, aId] = parseRef(a);
    const [bProtocol, bId] = parseRef(b);

    return aProtocol === bProtocol && aId === bId;
}
function parseRef(ref) {
    let out = ref.split(/:\/\//, 2);

    if (out.length === 1) {
        return ['kapeta', ref.toLowerCase()];
    }
    return [out[0].toLowerCase(), out[1].toLowerCase()];
}

class AssetManager {
    constructor() {
        this.cache = new NodeCache({
            stdTTL: 60 * 60, // 1 hour
        });
    }

    /**
     *
     * @param {string[]} [assetKinds]
     * @returns {{path: *, ref: string, data: *, editable: boolean, kind: *, exists: boolean}[]}
     */
    getAssets(assetKinds) {
        if (!assetKinds) {
            const blockTypeProviders = ClusterConfiguration.getDefinitions([
                'core/block-type',
                'core/block-type-operator',
            ]);
            assetKinds = blockTypeProviders.map((p) => {
                return `${p.definition.metadata.name}:${p.version}`;
            });
            assetKinds.push('core/plan');
        }

        const assets = ClusterConfiguration.getDefinitions(assetKinds);

        return assets.map(enrichAsset);
    }

    getPlans() {
        return this.getAssets(['core/plan']);
    }

    async getPlan(ref, noCache = false) {
        const asset = await this.getAsset(ref, noCache);

        if ('core/plan' !== asset.kind) {
            throw new Error('Asset was not a plan: ' + ref);
        }

        return asset.data;
    }

    async getAsset(ref, noCache = false) {
        const cacheKey = `getAsset:${ref}`;
        if (noCache !== true && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const uri = parseKapetaUri(ref);
        await repositoryManager.ensureAsset(uri.handle, uri.name, uri.version);

        let asset = ClusterConfiguration.getDefinitions()
            .map(enrichAsset)
            .find((a) => parseKapetaUri(a.ref).equals(uri));

        if (!asset) {
            throw new Error('Asset not found: ' + ref);
        }
        this.cache.set(cacheKey, asset);
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
        this.cache.flushAll();
        return asset;
    }

    async updateAsset(ref, yaml) {
        const asset = await this.getAsset(ref, true);
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
        this.cache.flushAll();
        if (codeGeneratorManager.canGenerateCode(yaml)) {
            await codeGeneratorManager.generate(asset.ymlPath, yaml);
        } else {
            console.log(
                'Could not generate code for %s',
                yaml.kind ? yaml.kind : 'unknown yaml'
            );
        }
    }

    async importFile(filePath) {
        if (filePath.startsWith('file://')) {
            filePath = filePath.substring('file://'.length);
        }

        if (!FS.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }

        const assetInfos = YAML.parseAllDocuments(
            FS.readFileSync(filePath).toString()
        ).map((doc) => doc.toJSON());

        await Actions.link(progressListener, Path.dirname(filePath));

        const version = 'local';
        const refs = assetInfos.map(
            (assetInfo) => `kapeta://${assetInfo.metadata.name}:${version}`
        );
        this.cache.flushAll();
        return this.getAssets().filter((a) =>
            refs.some((ref) => compareRefs(ref, a.ref))
        );
    }

    async unregisterAsset(ref) {
        const asset = await this.getAsset(ref, true);
        if (!asset) {
            throw new Error('Asset does not exists: ' + ref);
        }
        this.cache.flushAll();
        await Actions.uninstall(progressListener, [asset.ref]);
    }
}

module.exports = new AssetManager();
