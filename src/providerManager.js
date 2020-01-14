const _ = require('lodash');
const FS = require('fs');
const Path = require('path');
const Glob = require("glob");

const ClusterConfiguration = require('@blockware/local-cluster-config');

class ProviderManager {

    constructor() {

    }

    getWebAssets() {
        const webProviders = ClusterConfiguration.getProviderDefinitions().filter((providerDefinition) => providerDefinition.hasWeb);

        let jsFiles = [];
        webProviders.map((webProvider) => {
            return Glob.sync('web/**/*.js', {cwd: webProvider.path}).map((file) => {
                return Path.join(webProvider.path, file);
            });
        }).forEach((webFiles) => {
            jsFiles = jsFiles.concat(webFiles);
        });

        return jsFiles;
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