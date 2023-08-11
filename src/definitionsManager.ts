import ClusterConfiguration, { DefinitionInfo } from '@kapeta/local-cluster-config';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { doCached } from './cacheManager';

class DefinitionsManager {
    private getHash(kindFilter?: string | string[]) {
        if (kindFilter) {
            if (Array.isArray(kindFilter)) {
                return kindFilter.join(',');
            }
            return kindFilter;
        }
        return 'none';
    }

    private getFullKey(kindFilter?: string | string[]) {
        return `DefinitionsManager:${this.getHash(kindFilter)}`;
    }

    public getDefinitions(kindFilter?: string | string[]): DefinitionInfo[] {
        const key = this.getFullKey(kindFilter);

        return doCached<DefinitionInfo[]>(key, () => ClusterConfiguration.getDefinitions(kindFilter));
    }

    public exists(ref: string) {
        return !!this.getDefinition(ref);
    }

    public getProviderDefinitions(): DefinitionInfo[] {
        return doCached<DefinitionInfo[]>('providers', () => ClusterConfiguration.getProviderDefinitions());
    }

    public getDefinition(ref: string) {
        const uri = parseKapetaUri(ref);
        return this.getDefinitions().find((d) => {
            if (!uri.version) {
                return d.definition.metadata.name === uri.fullName;
            }
            return parseKapetaUri(`${d.definition.metadata.name}:${d.version}`).id === uri.id;
        });
    }
}

export const definitionsManager = new DefinitionsManager();
