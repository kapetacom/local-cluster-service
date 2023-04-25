const FS = require('fs');
const Path = require('path');
const repositoryManager = require('./repositoryManager')
const ClusterConfiguration = require('@kapeta/local-cluster-config');

async function readFile(path) {
    return new Promise((resolve, reject) => {
        FS.readFile(path, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.toString());
            }
        });
    });
}

async function fileExists(path) {
    return new Promise((resolve) => {
        FS.access(path, FS.constants.F_OK, (err) => {
            resolve(!err);
        });
    })
}

class ProviderManager {

    constructor() {
        this._webAssetCache = {};
    }

    getWebProviders() {
        return ClusterConfiguration
            .getProviderDefinitions()
            .filter((providerDefinition) => providerDefinition.hasWeb)
    }

    async getAsset(handle, name, version, sourceMap = false) {
        const fullName = `${handle}/${name}`;
        const id = `${handle}/${name}/${version}/web.js${sourceMap ? '.map' : ''}`;
        
        if (this._webAssetCache[id] &&
            await fileExists(this._webAssetCache[id])) {
            return readFile(this._webAssetCache[id]);
        }

        await repositoryManager.ensureAsset(handle, name, version);

        const installedProvider = this.getWebProviders().find((providerDefinition) => {
            return providerDefinition.definition.metadata.name === fullName &&
                providerDefinition.version === version;
        })

        if (installedProvider) {
            //Check locally installed providers
            const path = Path.join(installedProvider.path, 'web', handle, `${name}.js${sourceMap ? '.map' : ''}`);
            if (await fileExists(path)) {
                this._webAssetCache[id] = path;

                return readFile(path);
            }
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
