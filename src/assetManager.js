const _ = require('lodash');
const FS = require('fs');
const YAML = require('yaml');

const storageService = require('./storageService');

function enrichAsset(asset) {
    const exists = asset.path && FS.existsSync(asset.path);
    try {
        const data = exists ? YAML.parse(FS.readFileSync(asset.path).toString()) : undefined;
        return {
            ...asset,
            exists,
            data
        };
    } catch (err) {
        throw new Error('Failed to read asset on path: ' + asset.path + ' - ' + err.message);
    }
}

const SchemaHandlers = {
    file: function(id, ref) {
        if (!FS.existsSync(id)) {
            throw new Error('File not found: ' + id);
        }

        return [
            id,
            YAML.parse(FS.readFileSync(id).toString()),
        ];
    },
    github: function(id, ref) {
        throw new Error('GitHub schema is not yet implemented')
    },
    blockware: function(id, ref) {
        throw new Error('Blockware schema is not yet implemented')
    },
    http: function(id, ref) {
        throw new Error('HTTP schema is not yet implemented')
    },
    https: function(id, ref) {
        return this.http(id);
    }
};

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

    async createAsset(path, yaml) {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
        }

        FS.writeFileSync(path, YAML.stringify(yaml));

        return this.importAsset('file://' + path);
    }

    async importAsset(ref) {
        if (_.find(this._assets, {ref})) {
            throw new Error('Asset already registered: ' + ref);
        }

        const [protocol, id] = parseRef(ref);

        const schemaHandler = SchemaHandlers[protocol];

        const [path, content] = await schemaHandler(id, ref);

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