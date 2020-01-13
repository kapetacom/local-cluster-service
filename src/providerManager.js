const _ = require('lodash');
const FS = require('fs');
const Path = require('path');
const Glob = require("glob");
const storageService = require('./storageService');

const ClusterConfiguration = require('@blockware/local-cluster-config');

const ProvidersBasedir = Path.join(ClusterConfiguration.getBlockwareBasedir(), 'providers');

class ProviderManager {

    constructor() {
        this._providers = storageService.section('providers', []);
    }

    _save() {
        storageService.put('providers', this._providers);
    }



    getWebAssets() {
        const jsFiles = Glob.sync('**/web/**/*.js', {cwd: ProvidersBasedir})
        console.log('jsFiles', jsFiles);

        return jsFiles.map((file) => {
            return Path.join(ProvidersBasedir, file);
        });
    }

    /**
     * Returns all public (web) javascript for available providers.
     *
     * Provides frontend / applications with the implementation of the frontends for the
     * providers.
     *
     */
    getPublicJS() {
        const includedJS = this.getWebAssets().map((file) => {
            return FS.readFileSync(file).toString();
        }).join('\n\n');

        return `Blockware.applyProviders = function() {\n ${includedJS} \n};`
    }
}

module.exports = new ProviderManager();