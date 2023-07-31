import ClusterConfiguration, { DefinitionInfo } from '@kapeta/local-cluster-config';
import {parseKapetaUri} from "@kapeta/nodejs-utils";

const CACHE_TTL = 60 * 1000; // 1 min

interface DefinitionCacheEntry {
    expires: number;
    definitions: DefinitionInfo[];
}

class DefinitionsManager {
    private cache: { [key: string]: DefinitionCacheEntry } = {};

    private getKey(kindFilter?: string | string[]) {
        if (kindFilter) {
            if (Array.isArray(kindFilter)) {
                return kindFilter.join(',');
            }
            return kindFilter;
        }
        return 'none';
    }

    public clearCache() {
        this.cache = {};
    }

    private doCached(key: string, getter: () => DefinitionInfo[]) {
        if (this.cache[key]) {
            if (this.cache[key].expires > Date.now()) {
                return this.cache[key].definitions;
            }
            delete this.cache[key];
        }

        this.cache[key] = {
            expires: Date.now() + CACHE_TTL,
            definitions: getter(),
        };

        return this.cache[key].definitions;
    }

    public getDefinitions(kindFilter?: string | string[]) {
        const key = this.getKey(kindFilter);

        return this.doCached(key, () => ClusterConfiguration.getDefinitions(kindFilter));
    }

    public exists(ref: string) {
        const uri = parseKapetaUri(ref);
        return !!this.getDefinitions().find((d) => {
            return parseKapetaUri(`${d.definition.metadata.name}:${d.version}`).id === uri.id;
        });
    }

    public getProviderDefinitions() {
        return this.doCached('providers', () => ClusterConfiguration.getProviderDefinitions());
    }
}

export const definitionsManager = new DefinitionsManager();
