/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Path from 'path';
import { registry as Targets, BlockCodeGenerator, CodeWriter } from '@kapeta/codegen';
import { BlockDefinition } from '@kapeta/schemas';
import { definitionsManager } from './definitionsManager';
import { Definition } from '@kapeta/local-cluster-config';
import { assetManager } from './assetManager';
import { normalizeKapetaUri, parseKapetaUri } from '@kapeta/nodejs-utils';
import { repositoryManager } from './repositoryManager';

const TARGET_KIND = 'core/language-target';
const BLOCK_TYPE_REGEX = /^core\/block-type.*/;

class CodeGeneratorManager {
    private async ensureLanguageTargetInRegistry(path: string, version: string, definition: Definition) {
        const key = `${definition.metadata.name}:${version}`;

        try {
            if (await Targets.get(key)) {
                return;
            }
        } catch (e) {}

        try {
            const target = require(path);
            if (target.default) {
                Targets.register(key, target.default);
            } else {
                Targets.register(key, target);
            }
        } catch (e) {
            console.error('Failed to load target: %s', key, e);
        }
    }
    async reload() {
        Targets.reset();
        const languageTargets = await definitionsManager.getDefinitions(TARGET_KIND);
        for (const languageTarget of languageTargets) {
            await this.ensureLanguageTargetInRegistry(
                languageTarget.path,
                languageTarget.version,
                languageTarget.definition
            );
        }
    }

    async initialize() {
        await this.reload();
        repositoryManager.on('change', async () => {
            // Reload code generators when the repository changes
            try {
                await this.reload();
            } catch (e) {
                console.error('Failed to reload code generators', e);
            }
        });
    }

    async canGenerateCode(yamlContent: Definition): Promise<boolean> {
        if (!yamlContent.spec?.target?.kind || !yamlContent.kind) {
            //Not all block types have targets
            return false;
        }

        const kindUri = parseKapetaUri(yamlContent.kind);

        const blockTypes = await definitionsManager.getDefinitions([BLOCK_TYPE_REGEX]);
        const blockTypeKinds = blockTypes.map(
            (blockType) => parseKapetaUri(blockType.definition.metadata.name).fullName
        );
        return blockTypeKinds.includes(kindUri.fullName);
    }

    async generate(yamlFile: string, yamlContent: Definition) {
        if (!yamlContent.spec.target?.kind) {
            //Not all block types have targets
            return;
        }

        const targetRef = normalizeKapetaUri(yamlContent.spec.target?.kind);

        // Automatically downloads target if not available
        const targetAsset = await assetManager.getAsset(targetRef);

        if (!targetAsset) {
            console.error('Language target not found: %s', yamlContent.spec.target?.kind);
            return;
        }

        await this.ensureLanguageTargetInRegistry(targetAsset?.path, targetAsset?.version, targetAsset?.data);
        const baseDir = Path.dirname(yamlFile);
        console.log('Generating code for path: %s', baseDir);
        const codeGenerator = new BlockCodeGenerator(yamlContent as BlockDefinition);

        const output = await codeGenerator.generate();
        const writer = new CodeWriter(baseDir, {});
        const assets = writer.write(output);

        await codeGenerator.postprocess(baseDir, assets);

        console.log('Code generated for path: %s', baseDir);
    }
}

export const codeGeneratorManager = new CodeGeneratorManager();
