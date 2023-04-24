const _ = require('lodash');
const FS = require('fs');
const Path = require('path');
const Glob = require("glob");
const request = require('request-promise');

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

    async _downloadWebJSForAsset(handle, name, version) {
        const baseUrl = 'http://localhost:5018/files';

        let authHeader = undefined
        const authPath = ClusterConfiguration.getAuthenticationPath();
        if (FS.existsSync(authPath)) {
            const authFile = JSON.parse(FS.readFileSync(authPath));
            if (authFile.access_token) {
                authHeader = `Bearer ${authFile.access_token}`
            }
        }

        try {
            return await request({
                url: `${baseUrl}/files/${handle}/${name}/${version}/-/web/${handle}/${name}.js${sourceMap ? '.map' : ''}`,
                headers: {
                    'Authorization': authHeader
                }
            });
        } catch (e) {
            return null;
        }
    }

    async getAsset(handle, name, version, sourceMap = false) {
        const fullName = `${handle}/${name}`;
        const id = `${handle}/${name}/${version}/web.js${sourceMap ? '.map' : ''}`;
        
        if (this._webAssetCache[id]) {
            return readFile(this._webAssetCache[id]);
        }

        const localProvider = this.getWebProviders().find((providerDefinition) => {
            return providerDefinition.definition.metadata.name === fullName &&
                    providerDefinition.version === version;
        });

        if (localProvider) {
            //Check locally installed providers
            const path = Path.join(localProvider.path, 'web', handle, `${name}.js${sourceMap ? '.map' : ''}`);
            if (await fileExists(path)) {
                this._webAssetCache[id] = path;

                return readFile(path);
            }
        }

        if (version === 'local') {
            //No other place to get this from
            return null;
        }

        return this._downloadWebJSForAsset(handle, name, version, sourceMap);
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
