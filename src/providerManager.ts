import Path from 'path';
import FSExtra from 'fs-extra';
import { repositoryManager } from './repositoryManager';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { StringMap } from './types';
import { definitionsManager } from './definitionsManager';
import {cacheManager} from "./cacheManager";

class ProviderManager {


    getWebProviders() {
        return definitionsManager.getProviderDefinitions().filter((providerDefinition) => providerDefinition.hasWeb);
    }

    async getProviderWebJS(handle: string, name: string, version: string, sourceMap: boolean = false) {
        const fullName = `${handle}/${name}`;
        const id = `${handle}/${name}/${version}/web.js${sourceMap ? '.map' : ''}`;

        const cacheKey = `provider:web:${id}`;

        const file = cacheManager.get<string>(cacheKey);
        if (file && await FSExtra.pathExists(file)) {
            return FSExtra.readFile(file, 'utf8');
        }

        await repositoryManager.ensureAsset(handle, name, version, true);

        const installedProvider = this.getWebProviders().find((providerDefinition) => {
            return providerDefinition.definition.metadata.name === fullName && providerDefinition.version === version;
        });

        if (installedProvider) {
            //Check locally installed providers
            const path = Path.join(installedProvider.path, 'web', handle, `${name}.js${sourceMap ? '.map' : ''}`);
            if (await FSExtra.pathExists(path)) {
                cacheManager.set(cacheKey, path, 24* 60 * 60 * 1000);
                return FSExtra.readFile(path);
            }
        }

        return null;
    }
}

const providerDefinitions = definitionsManager.getProviderDefinitions();

if (providerDefinitions.length > 0) {
    console.log('## Loaded the following providers ##');
    providerDefinitions.forEach((providerDefinition) => {
        console.log(
            ' - %s[%s:%s]',
            providerDefinition.definition.kind,
            providerDefinition.definition.metadata.name,
            providerDefinition.version
        );
        console.log('   from %s', providerDefinition.path);
    });
} else {
    console.log('## No providers found ##');
}

export const providerManager = new ProviderManager();
