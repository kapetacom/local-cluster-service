import Path from 'node:path';
import FS from 'fs-extra';
import YAML from 'yaml';
import { Definition, DefinitionInfo } from '@kapeta/local-cluster-config';
import { codeGeneratorManager } from './codeGeneratorManager';
import { ProgressListener } from './progressListener';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { repositoryManager } from './repositoryManager';
import { BlockDefinition } from '@kapeta/schemas';
import { Actions } from '@kapeta/nodejs-registry-utils';
import { definitionsManager } from './definitionsManager';
import { normalizeKapetaUri } from './utils/utils';
import { taskManager } from './taskManager';
import { SourceOfChange } from './types';
import { cacheManager } from './cacheManager';
import uuid from 'node-uuid';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const toKey = (ref: string) => `assetManager:asset:${ref}`;

export interface EnrichedAsset {
    ref: string;
    editable: boolean;
    exists: boolean;
    version: string;
    kind: string;
    data: Definition;
    path: string;
    ymlPath: string;
}

function enrichAsset(asset: DefinitionInfo): EnrichedAsset {
    return {
        ref: `kapeta://${asset.definition.metadata.name}:${asset.version}`,
        editable: asset.version === 'local', //Only local versions are editable
        exists: true,
        version: asset.version,
        kind: asset.definition.kind,
        data: asset.definition,
        path: FS.realpathSync(asset.path),
        ymlPath: FS.realpathSync(asset.ymlPath),
    };
}

function compareRefs(a: string, b: string) {
    const [aProtocol, aId] = parseRef(a);
    const [bProtocol, bId] = parseRef(b);

    return aProtocol === bProtocol && aId === bId;
}

function parseRef(ref: string) {
    let out = ref.split(/:\/\//, 2);

    if (out.length === 1) {
        return ['kapeta', ref.toLowerCase()];
    }
    return [out[0].toLowerCase(), out[1].toLowerCase()];
}

class AssetManager {
    /**
     *
     * @param {string[]} [assetKinds]
     * @returns {{path: *, ref: string, data: *, editable: boolean, kind: *, exists: boolean}[]}
     */
    async getAssets(assetKinds?: string[]): Promise<EnrichedAsset[]> {
        if (!assetKinds) {
            const blockTypeProviders = await definitionsManager.getDefinitions([
                'core/block-type',
                'core/block-type-operator',
            ]);
            assetKinds = blockTypeProviders.map((p) => {
                return `${p.definition.metadata.name}:${p.version}`;
            });
            assetKinds.push('core/plan');
        }

        const assets = await definitionsManager.getDefinitions(assetKinds);

        return assets.map(enrichAsset);
    }

    async getPlans(): Promise<EnrichedAsset[]> {
        return this.getAssets(['core/plan']);
    }

    async getPlan(ref: string, noCache: boolean = false) {
        const asset = await this.getAsset(ref, noCache);

        if ('core/plan' !== asset?.kind) {
            throw new Error('Asset was not a plan: ' + ref);
        }

        return asset.data;
    }

    async getAsset(
        ref: string,
        noCache: boolean = false,
        autoFetch: boolean = true
    ): Promise<EnrichedAsset | undefined> {
        ref = normalizeKapetaUri(ref);
        const cacheKey = toKey(ref);
        if (!noCache && cacheManager.has(cacheKey)) {
            return cacheManager.get(cacheKey);
        }
        const uri = parseKapetaUri(ref);
        if (autoFetch) {
            await repositoryManager.ensureAsset(uri.handle, uri.name, uri.version, true);
        }

        const definitionInfo = await definitionsManager.getDefinition(ref);
        if (autoFetch && !definitionInfo) {
            throw new Error('Asset not found: ' + ref);
        }

        if (definitionInfo) {
            const asset = enrichAsset(definitionInfo);
            cacheManager.set(cacheKey, asset, CACHE_TTL);
            return asset;
        }

        return undefined;
    }

    async createAsset(
        path: string,
        yaml: BlockDefinition,
        sourceOfChange: SourceOfChange = 'filesystem'
    ): Promise<EnrichedAsset[]> {
        if (await FS.pathExists(path)) {
            throw new Error('File already exists: ' + path);
        }

        const dirName = Path.dirname(path);
        if (!(await FS.pathExists(dirName))) {
            await FS.mkdirp(dirName);
        }
        await repositoryManager.setSourceOfChangeFor(path, sourceOfChange);
        await FS.writeFile(path, YAML.stringify(yaml));
        const asset = await this.importFile(path);
        asset.forEach((a) => {
            const ref = normalizeKapetaUri(a.ref);
            const key = toKey(ref);
            cacheManager.set(key, a, CACHE_TTL);
        });

        definitionsManager.clearCache();
        console.log(`Created asset at: ${path}`);

        const ref = `kapeta://${yaml.metadata.name}:local`;

        await this.maybeGenerateCode(ref, path, yaml);

        return asset;
    }

    async updateAsset(ref: string, yaml: BlockDefinition, sourceOfChange: SourceOfChange = 'filesystem') {
        ref = normalizeKapetaUri(ref);
        const asset = await this.getAsset(ref, true, false);
        if (!asset) {
            throw new Error('Attempted to update unknown asset: ' + ref);
        }

        if (!asset.editable) {
            throw new Error('Attempted to update read-only asset: ' + ref);
        }

        if (!asset.ymlPath) {
            throw new Error('Attempted to update corrupted asset: ' + ref);
        }

        await repositoryManager.setSourceOfChangeFor(asset.ymlPath, sourceOfChange);
        await FS.writeFile(asset.ymlPath, YAML.stringify(yaml));
        console.log(`Updated asset at: ${asset.ymlPath}`);

        cacheManager.remove(toKey(ref));
        definitionsManager.clearCache();

        await this.maybeGenerateCode(asset.ref, asset.ymlPath, yaml);
    }

    async importFile(filePath: string) {
        if (filePath.startsWith('file://')) {
            filePath = filePath.substring('file://'.length);
        }

        if (!(await FS.pathExists(filePath))) {
            throw new Error('File not found: ' + filePath);
        }
        const content = await FS.readFile(filePath);

        const assetInfos = YAML.parseAllDocuments(content.toString()).map((doc) => doc.toJSON());

        await Actions.link(new ProgressListener(), Path.dirname(filePath));

        const version = 'local';
        const refs = assetInfos.map((assetInfo) =>
            normalizeKapetaUri(`kapeta://${assetInfo.metadata.name}:${version}`)
        );
        refs.forEach((ref) => {
            const key = toKey(ref);
            cacheManager.remove(key);
        });

        definitionsManager.clearCache();

        const assets = await this.getAssets();

        return assets.filter((a) => refs.some((ref) => compareRefs(ref, a.ref)));
    }

    async unregisterAsset(ref: string) {
        const asset = await this.getAsset(ref, true);
        if (!asset) {
            throw new Error('Asset does not exists: ' + ref);
        }

        const key = toKey(ref);
        cacheManager.remove(key);
        definitionsManager.clearCache();

        await Actions.uninstall(new ProgressListener(), [asset.ref]);
    }

    async installAsset(ref: string) {
        const asset = await this.getAsset(ref, true, false);
        if (asset) {
            throw new Error('Asset already installed: ' + ref);
        }
        const uri = parseKapetaUri(ref);
        console.log('Installing %s', ref);
        const key = toKey(ref);
        cacheManager.remove(key);
        definitionsManager.clearCache();

        return await repositoryManager.ensureAsset(uri.handle, uri.name, uri.version, false);
    }

    private async maybeGenerateCode(ref: string, ymlPath: string, block: BlockDefinition) {
        ref = normalizeKapetaUri(ref);
        if (await codeGeneratorManager.canGenerateCode(block)) {
            const assetTitle = block.metadata.title ? block.metadata.title : parseKapetaUri(block.metadata.name).name;
            const taskId = `codegen:${uuid.v4()}`;
            const group = `codegen:${ref}`;
            // We group the codegen tasks since we want to run them all but only 1 at a time per block
            taskManager.add(
                taskId,
                async () => {
                    await codeGeneratorManager.generate(ymlPath, block);
                },
                {
                    name: `Generating code for ${assetTitle}`,
                    group, //Group prevents multiple tasks from running at the same time
                }
            );
            return true;
        }
        return false;
    }
}

export const assetManager = new AssetManager();
