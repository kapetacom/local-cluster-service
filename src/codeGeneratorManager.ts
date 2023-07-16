import Path from 'path';
import {registry as Targets, BlockCodeGenerator, CodeWriter} from '@kapeta/codegen';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import {BlockDefinition} from "@kapeta/schemas";

const TARGET_KIND = 'core/language-target';
const BLOCK_TYPE_KIND = 'core/block-type';

class CodeGeneratorManager {

    async reload() {
        Targets.reset();
        const languageTargets = ClusterConfiguration.getDefinitions(TARGET_KIND);
        for (const languageTarget of languageTargets) {
            const key = `${languageTarget.definition.metadata.name}:${languageTarget.version}`
            try {
                const target = require(languageTarget.path);
                if (target.default) {
                    Targets.register(key, target.default);
                } else {
                    Targets.register(key, target);
                }
            } catch (e) {
                console.error('Failed to load target: %s', key, e);
            }
        }
    }

    canGenerateCode(yamlContent:BlockDefinition):boolean {
        if (!yamlContent.spec.target?.kind) {
            //Not all block types have targets
            return false;
        }

        const blockTypes = ClusterConfiguration.getDefinitions(BLOCK_TYPE_KIND);
        const blockTypeKinds = blockTypes.map(blockType => blockType.definition.metadata.name.toLowerCase() + ':' + blockType.version);
        return !!(yamlContent && yamlContent.kind && blockTypeKinds.indexOf(yamlContent.kind.toLowerCase()) > -1);
    }

    async generate(yamlFile:string, yamlContent:BlockDefinition) {
        const baseDir = Path.dirname(yamlFile);
        console.log('Generating code for path: %s', baseDir);
        const codeGenerator = new BlockCodeGenerator(yamlContent);

        const output = await codeGenerator.generate();
        const writer = new CodeWriter(baseDir, {});
        const assets = writer.write(output);

        await codeGenerator.postprocess(baseDir, assets);

        console.log('Code generated for path: %s', baseDir);
    }
}

export const codeGeneratorManager = new CodeGeneratorManager();
codeGeneratorManager.reload();