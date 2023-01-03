const Path = require('path');

const {registry:Targets, BlockCodeGenerator, CodeWriter} = require('@blockware/codegen');
const ClusterConfiguration = require('@blockware/local-cluster-config');
const TARGET_KIND = 'core/language-target';
const BLOCK_TYPE_KIND = 'core/block-type';

class CodeGeneratorManager {

    reload() {
        Targets.reset();
        const languageTargets = ClusterConfiguration.getDefinitions(TARGET_KIND);
        languageTargets.forEach((languageTarget) => {
            const key = `${languageTarget.definition.metadata.name}:${languageTarget.version}`
            Targets.register(key, require(languageTarget.path));
        });
    }

    canGenerateCode(yamlContent) {
        const blockTypes = ClusterConfiguration.getDefinitions(BLOCK_TYPE_KIND);
        const blockTypeKinds = blockTypes.map(blockType => blockType.definition.metadata.name.toLowerCase() + ':' + blockType.version);
        return yamlContent && yamlContent.kind && blockTypeKinds.indexOf(yamlContent.kind.toLowerCase()) > -1;
    }

    async generate(yamlFile, yamlContent) {
        const baseDir = Path.dirname(yamlFile);
        console.log('Generating code for path: %s', baseDir);
        const codeGenerator = new BlockCodeGenerator(yamlContent);

        const output = await codeGenerator.generate();
        const writer = new CodeWriter(baseDir, {});
        writer.write(output);

        console.log('Code generated for path: %s', baseDir);
    }
}

const manager = new CodeGeneratorManager();
manager.reload();
module.exports = manager;