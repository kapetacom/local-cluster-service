const _ = require('lodash');
const FS = require('fs');
const Path = require('path');
const Glob = require("glob");

const ClusterConfiguration = require('@blockware/local-cluster-config');

class ProviderManager {

    constructor() {
        this._assetCache = {};
    }

    getWebProviders() {
        return ClusterConfiguration
            .getProviderDefinitions()
            .filter((providerDefinition) => providerDefinition.hasWeb)
    }

    getWebAssets() {
        const webProviders = this.getWebProviders();

        let providerFiles = [];
        webProviders.map((webProvider) => {
            return Glob.sync('web/**/*.js', {cwd: webProvider.path}).map((file) => {
                return {webProvider, file};
            });
        }).forEach((webFiles) => {
            providerFiles.push(...webFiles);
        });

        return providerFiles;
    }

    loadAssets() {
        this.getWebAssets().forEach((asset) => {
            const providerId = asset.webProvider.definition.metadata.name;
            const file = asset.file;
            const assetId = `${providerId}/${asset.webProvider.version}/${file}`;
            this._assetCache[assetId] = Path.join(asset.webProvider.path, file);
        })
    }


    /**
     * Returns all public (web) javascript for available providers.
     *
     * Provides frontend / applications with the implementation of the frontends for the
     * providers.
     *
     */
    getPublicJS() {
        this.loadAssets();
        const includes = Object.keys(this._assetCache).map((assetId) => {
            return `${ClusterConfiguration.getClusterServiceAddress()}/providers/asset/${assetId}`
        });

        return `Blockware.setPluginPaths(${JSON.stringify(includes)});`
    }

    getAsset(id) {
        if (_.isEmpty(this._assetCache)) {
            this.loadAssets();
        }
        if (this._assetCache[id]) {
            return FS.readFileSync(this._assetCache[id]).toString();
        }
        return null;
    }
}

const providerDefinitions = ClusterConfiguration.getProviderDefinitions();

if (providerDefinitions.length > 0) {
    console.log('## Loaded the following providers ##');
    providerDefinitions.forEach(providerDefinition => {
        console.log(' - %s[%s:%s]', providerDefinition.definition.kind, providerDefinition.definition.metadata.name, providerDefinition.version);
        console.log('   from %s', providerDefinition.path);
    })
} else {
    console.log('## No providers found ##');
}

module.exports = new ProviderManager();