const _ = require('lodash');
const FS = require('fs');
const Path = require('path');
const Glob = require("glob");
const storageService = require('./storageService');

const ClusterConfiguration = require('@blockware/local-cluster-config');

const PROVIDER_BASEDIR = ClusterConfiguration.getProvidersBasedir();

class ProviderManager {

    constructor() {
        this._providers = storageService.section('providers', []);
    }

    _save() {
        storageService.put('providers', this._providers);
    }

    getWebAssets() {
        const jsFiles = Glob.sync('**/web/**/*.js', {cwd: PROVIDER_BASEDIR});

        return jsFiles.map((file) => {
            return Path.join(PROVIDER_BASEDIR, file);
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

const providerDefinitions = ClusterConfiguration.getProviderDefinitions();

if (providerDefinitions.length > 0) {
    console.log('## Loaded the following providers ##');
    providerDefinitions.forEach(providerDefinition => {
        console.log(' - %s[%s]', providerDefinition.definition.kind, providerDefinition.definition.metadata.id);
        console.log('   from %s', providerDefinition.path);
    })
} else {
    console.log('## No providers found ##');
}

module.exports = new ProviderManager();