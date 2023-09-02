import ClusterConfiguration, { DefinitionInfo } from '@kapeta/local-cluster-config';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { cacheManager, doCached } from './cacheManager';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { Plan } from '@kapeta/schemas';
import FS from 'fs-extra';
import { normalizeKapetaUri } from './utils/utils';
import YAML from 'yaml';
import { Actions } from '@kapeta/nodejs-registry-utils';
import { ProgressListener } from './progressListener';
import Path from 'path';

export const SAMPLE_PLAN_NAME = 'kapeta/sample-nodejs-plan';

function applyHandleChange(definition: DefinitionInfo, targetHandle: string) {
    const originalUri = parseKapetaUri(definition.definition.metadata.name);
    definition.definition.metadata.name = `${targetHandle}/${originalUri.name}`;
    return definition;
}

function normalizeFilters(kindFilter?: string | string[]) {
    let resolvedFilters: string[] = [];

    if (kindFilter) {
        if (Array.isArray(kindFilter)) {
            resolvedFilters = [...kindFilter];
        } else {
            resolvedFilters = [kindFilter];
        }
    }

    return resolvedFilters.map((k) => k.toLowerCase());
}

class DefinitionsManager {
    private async resolveDefinitionsAndSamples() {
        const definitions = ClusterConfiguration.getDefinitions();
        const samplePlan = definitions.find(
            (d) => d.version === 'local' && d.definition.metadata.name === SAMPLE_PLAN_NAME
        );

        if (!samplePlan) {
            return definitions;
        }

        // We will only rewrite the sample plan once since we change the handle to be the users handle
        const api = new KapetaAPI();
        if (!api.hasToken()) {
            // Not logged in yet, so we can't rewrite the sample plan
            return definitions;
        }
        const profile = await api.getCurrentIdentity();
        if (!profile) {
            // Not logged in yet, so we can't rewrite the sample plan
            return definitions;
        }

        console.log('Rewriting sample plan to use handle %s', profile.handle);

        applyHandleChange(samplePlan, profile.handle);

        const planDef = samplePlan.definition as Plan;

        const blockRefs = new Set<string>();

        planDef.spec.blocks.forEach((b) => {
            const blockUri = parseKapetaUri(b.block.ref);
            if (blockUri.version === 'local') {
                blockRefs.add(blockUri.id);
                b.block.ref = normalizeKapetaUri(`${profile.handle}/${blockUri.name}:local`);
            }
        });

        // Rewrite all blocks that are referenced by the sample plan
        const rewrittenBlocks = Array.from(blockRefs)
            .map((ref) =>
                definitions.find(
                    (d) => normalizeKapetaUri(d.definition.metadata.name + ':' + d.version) === normalizeKapetaUri(ref)
                )
            )
            .filter((d) => d !== undefined)
            .map((d) => applyHandleChange(d!, profile.handle));

        // Persist the rewritten assets
        const progressListener = new ProgressListener();
        const rewrittenAssets = [samplePlan, ...rewrittenBlocks];
        const originalRefs = [`${SAMPLE_PLAN_NAME}:local`, ...Array.from(blockRefs)];

        // Store the original paths on the assets - we'll need them later
        for (const asset of rewrittenAssets) {
            asset.path = await FS.readlink(asset.path);
            asset.ymlPath = Path.join(asset.path, Path.basename(asset.ymlPath));
        }

        // Uninstall the original assets
        // This removes the symlinks
        console.log('Uninstalling original assets', originalRefs);
        try {
            await Actions.uninstall(progressListener, originalRefs);
        } catch (err) {
            console.warn('Failed to uninstall original assets', err);
        }

        for (const asset of rewrittenAssets) {
            console.log('Updating %s ', asset.ymlPath);
            await FS.writeFile(asset.ymlPath, YAML.stringify(asset.definition));

            console.log('Linking %s ', asset.path);
            await Actions.link(progressListener, asset.path);
        }

        console.log('Rewrite done for sample plan');

        // Return the rewritten definitions
        return ClusterConfiguration.getDefinitions();
    }

    private applyFilters(definitions: DefinitionInfo[], kindFilter: string[]): DefinitionInfo[] {
        if (kindFilter.length === 0) {
            return definitions;
        }

        return definitions.filter((d) => {
            return kindFilter.includes(d.definition.kind.toLowerCase());
        });
    }

    public async getDefinitions(kindFilter?: string | string[]): Promise<DefinitionInfo[]> {
        kindFilter = normalizeFilters(kindFilter);

        const definitions = await doCached<Promise<DefinitionInfo[]>>('definitionsManager:all', () =>
            this.resolveDefinitionsAndSamples()
        );

        return this.applyFilters(definitions, kindFilter);
    }

    public async exists(ref: string) {
        return !!(await this.getDefinition(ref));
    }

    public async getProviderDefinitions(): Promise<DefinitionInfo[]> {
        return doCached<DefinitionInfo[]>('definitionsManager:providers', () =>
            ClusterConfiguration.getProviderDefinitions()
        );
    }

    public async getDefinition(ref: string) {
        const uri = parseKapetaUri(ref);
        const definitions = await this.getDefinitions();
        return definitions.find((d) => {
            if (!uri.version) {
                return d.definition.metadata.name === uri.fullName;
            }
            return parseKapetaUri(`${d.definition.metadata.name}:${d.version}`).id === uri.id;
        });
    }

    public clearCache() {
        cacheManager.removePrefix('definitionsManager:');
    }
}

export const definitionsManager = new DefinitionsManager();
