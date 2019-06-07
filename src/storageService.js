const _ = require('lodash');
const OS = require('os');
const Path = require('path');
const FS = require('fs');
const mkdirp = require('mkdirp');

const HOMEDIR = OS.homedir();

const BLOCKCTL_DIR = Path.join(HOMEDIR, '.blockctl');
const STORAGE_PATH = Path.join(BLOCKCTL_DIR,'local-cluster-service.json');

/**
 * Class that handles reading and writing from local configuration file.
 */
class StorageService {

    constructor() {
        this._data = this._readConfig();
    }

    _readConfig() {
        if (FS.existsSync(STORAGE_PATH)) {
            return JSON.parse(FS.readFileSync(STORAGE_PATH).toString());
        }

        return {};
    }

    _writeConfig() {
        mkdirp.sync(BLOCKCTL_DIR);
        FS.writeFileSync(STORAGE_PATH, JSON.stringify(this._data, null, 2));
    }

    section(section) {
        if (!this._data[section]) {
            this._data[section] = {};
        }

        return this._data[section];
    }

    put(section, property, value) {
        if (_.isObject(property)) {
            this._data[section] = property;
            this._writeConfig();
            return;
        }

        this.section(section)[property] = value;
        this._writeConfig();
    }

    get(section, property) {
        return this.section(section)[property];
    }

    contains(section, property) {
        if (!this._data[section]) {
            return false;
        }

        return this._data[section].hasOwnProperty(property);
    }

    ensure(section, property, value) {
        if (this.contains(section, property)) {
            return this.get(section, property);
        }

        let out = value;
        if (typeof value === 'function') {
            out = value();
        }

        this.put(section, property, out);

        return out;
    }
}

module.exports = new StorageService();