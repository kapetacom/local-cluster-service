import Path from 'node:path';
import FS from 'node:fs';
import FSExtra from 'fs-extra';
import YAML from 'yaml';
import NodeCache from 'node-cache';
import ClusterConfiguration, { Definition, DefinitionInfo } from '@kapeta/local-cluster-config';
import { codeGeneratorManager } from './codeGeneratorManager';
import { progressListener } from './progressListener';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { repositoryManager } from './repositoryManager';
import { BlockDefinition } from '@kapeta/schemas';
import { Actions } from '@kapeta/nodejs-registry-utils';
import { definitionsManager } from './definitionsManager';
import { normalizeKapetaUri } from './utils/utils';
import {taskManager} from "./taskManager";

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
        path: asset.path,
        ymlPath: asset.ymlPath,
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
    private cache: NodeCache;

    constructor() {
        this.cache = new NodeCache({
            stdTTL: 60 * 60, // 1 hour
        });
    }

    public clearCache() {
        this.cache.flushAll();
    }

    /**
     *
     * @param {string[]} [assetKinds]
     * @returns {{path: *, ref: string, data: *, editable: boolean, kind: *, exists: boolean}[]}
     */
    getAssets(assetKinds?: string[]): EnrichedAsset[] {
        if (!assetKinds) {
            const blockTypeProviders = definitionsManager.getDefinitions([
                'core/block-type',
                'core/block-type-operator',
            ]);
            assetKinds = blockTypeProviders.map((p) => {
                return `${p.definition.metadata.name}:${p.version}`;
            });
            assetKinds.push('core/plan');
        }

        const assets = definitionsManager.getDefinitions(assetKinds);

        return assets.map(enrichAsset);
    }

    getPlans(): EnrichedAsset[] {
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
        const cacheKey = `getAsset:${ref}`;
        if (!noCache && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        const uri = parseKapetaUri(ref);
        if (autoFetch) {
            await repositoryManager.ensureAsset(uri.handle, uri.name, uri.version, true);
        }

        let asset = definitionsManager
            .getDefinitions()
            .map(enrichAsset)
            .find((a) => parseKapetaUri(a.ref).equals(uri));
        if (autoFetch && !asset) {
            throw new Error('Asset not found: ' + ref);
        }
        if (asset) {
            this.cache.set(cacheKey, asset);
        }

        return asset;
    }

    async createAsset(path: string, yaml: BlockDefinition): Promise<EnrichedAsset[]> {
        if (FS.existsSync(path)) {
            throw new Error('File already exists: ' + path);
        }

        const dirName = Path.dirname(path);
        if (!FS.existsSync(dirName)) {
            FSExtra.mkdirpSync(dirName);
        }

        console.log('Wrote to ' + path);
        FS.writeFileSync(path, YAML.stringify(yaml));

        const asset = await this.importFile(path);
        console.log('Imported');

        this.cache.flushAll();
        definitionsManager.clearCache();

        const ref = `kapeta://${yaml.metadata.name}:local`;

        this.maybeGenerateCode(ref, path, yaml);

        return asset;
    }

    async updateAsset(ref: string, yaml: BlockDefinition) {
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

        console.log('Wrote to ' + asset.ymlPath);
        FS.writeFileSync(asset.ymlPath, YAML.stringify(yaml));
        this.cache.flushAll();
        definitionsManager.clearCache();

        this.maybeGenerateCode(asset.ref, asset.ymlPath, yaml);
    }

    private maybeGenerateCode(ref:string, ymlPath:string, block: BlockDefinition) {
        ref = normalizeKapetaUri(ref);
        if (codeGeneratorManager.canGenerateCode(block)) {
            const assetTitle = block.metadata.title ? block.metadata.title : parseKapetaUri(block.metadata.name).name;
            taskManager.add(`codegen:${ref}`, async () => {
                await codeGeneratorManager.generate(ymlPath, block);
            },{
                name: `Generating code for ${assetTitle}`,
            });
            return true;
        }
        return false;
    }

    async importFile(filePath: string) {
        if (filePath.startsWith('file://')) {
            filePath = filePath.substring('file://'.length);
        }

        if (!FS.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }

        const assetInfos = YAML.parseAllDocuments(FS.readFileSync(filePath).toString()).map((doc) => doc.toJSON());

        await Actions.link(progressListener, Path.dirname(filePath));

        const version = 'local';
        const refs = assetInfos.map((assetInfo) => `kapeta://${assetInfo.metadata.name}:${version}`);
        this.cache.flushAll();
        return this.getAssets().filter((a) => refs.some((ref) => compareRefs(ref, a.ref)));
    }

    async unregisterAsset(ref: string) {
        const asset = await this.getAsset(ref, true);
        if (!asset) {
            throw new Error('Asset does not exists: ' + ref);
        }
        this.cache.flushAll();
        await Actions.uninstall(progressListener, [asset.ref]);
    }

    async installAsset(ref: string) {
        const asset = await this.getAsset(ref, true, false);
        if (asset) {
            throw new Error('Asset already installed: ' + ref);
        }
        const uri = parseKapetaUri(ref);
        console.log('Installing %s', ref);

        return await repositoryManager.ensureAsset(uri.handle, uri.name, uri.version, false);
    }
}

export const assetManager = new AssetManager();
