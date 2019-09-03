const _ = require('lodash');
const OS = require('os');
const Path = require('path');
const FS = require('fs');
const mkdirp = require('mkdirp');
const YAML = require('yaml');

const HOMEDIR = OS.homedir();

const BLOCKWARE_DIR = Path.join(HOMEDIR, '.blockware');
const STORAGE_PATH = Path.join(BLOCKWARE_DIR, 'cluster-service.yml');

/**
 * Class that handles reading and writing from local configuration file.
 */
class StorageService {

    constructor() {
        this._data = this._readConfig();
    }

    getBlockwareBasedir() {
        return BLOCKWARE_DIR;
    }

    _readConfig() {
        if (FS.existsSync(STORAGE_PATH)) {
            console.log('Reading configuration from %s', STORAGE_PATH);
            return YAML.parse(FS.readFileSync(STORAGE_PATH).toString());
        } else {
            console.log('Configuration file not found %s', STORAGE_PATH);
        }

        return {};
    }

    _writeConfig() {
        mkdirp.sync(BLOCKWARE_DIR);
        FS.writeFileSync(STORAGE_PATH, YAML.stringify(this._data));
    }

    section(section, defaultValue) {
        if (!defaultValue) {
            defaultValue = {};
        }
        if (!this._data[section]) {
            this._data[section] = defaultValue;
            this._writeConfig();
        }

        return this._data[section];
    }

    put(section, property, value) {
        if (!_.isString(property)) {
            this._data[section] = property;
            this._writeConfig();
            return;
        }

        this.section(section)[property] = value;
        this._writeConfig();
    }

    get(section, property) {
        if (!property) {
            return this.section(section);
        }

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