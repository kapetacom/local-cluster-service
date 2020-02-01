const _ = require('lodash');
const FS = require('fs');
const YAML = require('yaml');
const SchemaHandlers = require('./assets/schema-handlers');
const storageService = require('./storageService');
const codeGeneratorManager = require('./codeGeneratorManager');
const PlanKindHandler = require('./assets/kind-handlers/PlanKindHandler');

function enrichAsset(asset) {
    const exists = asset.path && FS.existsSync(asset.path);
    const [protocol, id] = parseRef(asset.ref);

    const SchemaHandler = SchemaHandlers.get(protocol);

    const editable = SchemaHandler.isEditable(id, asset.ref);

    try {
        let data = exists ? YAML.parse(FS.readFileSync(asset.path).toString()) : undefined;

        if (data && PlanKindHandler.isKind(data.kind)) {
            data = PlanKindHandler.resolveAbsoluteFileRefs(asset.path, data);
        }

        return {
            ...asset,
            editable,
            exists,
            data
        };
    } catch (err) {
        throw new Error('Failed to read asset on path: ' + asset.path + ' - ' + err.message);
    }
}

function parseRef(ref) {
    let out = ref.split(/:\/\//,2);

    return [
        out[0].toLowerCase(),
        out[1]
    ];
}

class AssetManager {

    constructor() {
        this._assets = storageService.section('assets', []);
    }

    _save() {
        storageService.put('assets', this._assets);
    }

    getAssets() {
        if (!this._assets) {
            return [];
        }

        return _.clone(this._assets).map(enrichAsset);
    }

    getPlans() {
        return this.getAssets().filter((asset) => {
            return PlanKindHandler.isKind(asset.kind);
        });
    }

    getPlan(ref) {
        const asset = this.getAsset(ref);

        if (!PlanKindHandler.isKind(asset.kind)) {
            throw new Error('Asset was not a plan: ' + ref);
        }

        return asset.data;
    }

    getAsset(ref) {
        const asset = _.find(this._assets, {ref});
        if (!asset) {
            throw new Error('Asset not found: ' + ref);
        }

        return enrichAsset(asset);
    }

    async createAsset(path, yaml) {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
        }

        FS.writeFileSync(path, YAML.stringify(yaml));

        const asset = await this.importAsset('file://' + path);

        if (codeGeneratorManager.canGenerateCode(yaml)) {
            await codeGeneratorManager.generate(path, yaml);
        }

        return asset;
    }

    async updateAsset(ref, yaml) {
        const [protocol, id] = parseRef(ref);

        const SchemaHandler = SchemaHandlers.get(protocol);

        console.log('Updating asset', ref);

        const yamlFile = await SchemaHandler.pack(id, ref, yaml);

        if (codeGeneratorManager.canGenerateCode(yaml)) {
            await codeGeneratorManager.generate(yamlFile, yaml);
        }

    }

    async importAsset(ref) {
        if (_.find(this._assets, {ref})) {
            throw new Error('Asset already registered: ' + ref);
        }

        console.log('Importing asset', ref);

        const [protocol, id] = parseRef(ref);

        const SchemaHandler = SchemaHandlers.get(protocol);

        const [path, content] = await SchemaHandler.unpack(id, ref);

        if (!content || !content.kind) {
            throw new Error('Invalid asset - missing kind: ' + ref);
        }

        const asset = {
            ref,
            path,
            kind: content.kind,
        };

        this._assets.push(asset);
        this._save();

        return enrichAsset(asset);
    }

    unregisterAsset(ref) {
        if (!_.find(this._assets, {ref: ref})) {
            throw new Error('Asset does not exists: ' + ref);
        }

        _.remove(this._assets, {ref: ref});
        this._save();
    }
}

module.exports = new AssetManager();