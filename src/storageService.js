const _ = require('lodash');
const FS = require('fs');
const mkdirp = require('mkdirp');
const YAML = require('yaml');
const ClusterConfiguration = require('@blockware/local-cluster-config');

/**
 * Class that handles reading and writing from local configuration file.
 */
class StorageService {

    constructor() {
        this._data = this._readConfig();
    }

    getBlockwareBasedir() {
        return ClusterConfiguration.getBlockwareBasedir();
    }

    _readConfig() {
        return ClusterConfiguration.getClusterConfig();
    }

    _writeConfig() {
        const configFile = ClusterConfiguration.getClusterConfigFile();

        mkdirp.sync(this.getBlockwareBasedir());

        FS.writeFileSync(configFile, YAML.stringify(this._data));
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