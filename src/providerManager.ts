/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Path from 'path';
import FSExtra from 'fs-extra';
import { definitionsManager } from './definitionsManager';
import { cacheManager } from './cacheManager';
import request from 'request';
import { DefinitionInfo } from '@kapeta/local-cluster-config';

const PROVIDER_FILE_BASE = 'https://providers.kapeta.com/files';

class ProviderManager {
    async getWebProviders(): Promise<DefinitionInfo[]> {
        const providers = await definitionsManager.getProviderDefinitions();
        return providers.filter((providerDefinition) => providerDefinition.hasWeb);
    }

    async getProviderWebJS(handle: string, name: string, version: string, sourceMap: boolean = false) {
        const fullName = `${handle}/${name}`;
        const id = `${handle}/${name}/${version}/web.js${sourceMap ? '.map' : ''}`;

        const cacheKey = `provider:web:${id}`;

        const file = cacheManager.get<string>(cacheKey);
        if (file && (await FSExtra.pathExists(file))) {
            return FSExtra.readFile(file, 'utf8');
        }

        const providers = await this.getWebProviders();
        const installedProvider = providers.find((providerDefinition) => {
            return providerDefinition.definition.metadata.name === fullName && providerDefinition.version === version;
        });

        if (installedProvider) {
            //Check locally installed providers
            const path = Path.join(installedProvider.path, 'web', handle, `${name}.js${sourceMap ? '.map' : ''}`);
            if (await FSExtra.pathExists(path)) {
                cacheManager.set(cacheKey, path, 24 * 60 * 60 * 1000);
                return FSExtra.readFile(path);
            }
        }

        if (version === 'local') {
            return null;
        }

        const url = `${PROVIDER_FILE_BASE}/${id}`;
        return new Promise((resolve, reject) => {
            console.log('Loading provider from %s', url);
            request.get(url, (error, response, body) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (response.statusCode === 404) {
                    resolve(null);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to load provider from ${url}: ${body}`));
                    return;
                }

                resolve(body);
            });
        });
    }
}

definitionsManager
    .getProviderDefinitions()
    .then((providerDefinitions) => {
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
            console.log('##');
        } else {
            console.log('## No providers found ##');
        }
    })
    .catch((e) => {
        console.error('Failed to load providers', e);
    });

export const providerManager = new ProviderManager();
