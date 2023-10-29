/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import _ from 'lodash';
import FS from 'fs';
import FSExtra from 'fs-extra';
import YAML from 'yaml';
import ClusterConfiguration from '@kapeta/local-cluster-config';

/**
 * Class that handles reading and writing from local configuration file.
 */
class StorageService {
    private _data: { [key: string]: any };

    constructor() {
        this._data = this._readConfig();
    }

    getKapetaBasedir() {
        return ClusterConfiguration.getKapetaBasedir();
    }

    _readConfig() {
        return ClusterConfiguration.getClusterConfig();
    }

    _writeConfig() {
        const configFile = ClusterConfiguration.getClusterConfigFile();

        FSExtra.mkdirsSync(this.getKapetaBasedir());

        FS.writeFileSync(configFile, YAML.stringify(this._data));
    }

    section<T = any>(section: string, defaultValue?: any): T {
        if (!defaultValue) {
            defaultValue = {};
        }
        if (!this._data[section]) {
            this._data[section] = defaultValue;
            this._writeConfig();
        }

        return this._data[section];
    }

    put(section: string, property: string | any, value?: any) {
        if (!_.isString(property)) {
            this._data[section] = property;
            this._writeConfig();
            return;
        }

        this.section(section)[property] = value;
        this._writeConfig();
    }

    get<T = any>(section: string, property?: string, defaultValue?: T): T | undefined {
        if (!property) {
            return this.section(section);
        }

        if (!this.contains(section, property)) {
            return defaultValue;
        }

        return this.section(section)[property];
    }

    contains(section: string, property: string) {
        if (!this._data[section]) {
            return false;
        }

        return this._data[section].hasOwnProperty(property);
    }

    ensure(section: string, property: string, value: any) {
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

export const storageService = new StorageService();
