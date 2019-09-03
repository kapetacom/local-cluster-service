const _ = require('lodash');
const FS = require('fs');
const YAML = require('yaml');
const UUID = require('node-uuid');

const storageService = require('./storageService');

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

        return _.clone(this._assets);
    }

    createAsset(path, yaml) {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
        }

        FS.writeFileSync(path, YAML.stringify(yaml));

        return this.registerAsset(path);
    }

    registerAsset(path) {
        if (!FS.existsSync(path)) {
            throw new Error('Asset does not exists: ' + path);
        }

        if (_.find(this._assets, {path})) {
            throw new Error('Asset already registered: ' + path);
        }

        const content = YAML.parse(FS.readFileSync(path).toString());

        if (!content || !content.kind) {
            throw new Error('Invalid asset - missing kind: ' + path);
        }

        const asset = {
            id: UUID.v4(),
            kind: content.kind,
            path
        };

        this._assets.push(asset);
        this._save();

        return asset;
    }

    unregisterAsset(path) {
        if (!_.find(this._assets, {path})) {
            throw new Error('Asset does not exists: ' + path);
        }

        _.remove(this._assets, {path});
        this._save();
    }
}

module.exports = new AssetManager();