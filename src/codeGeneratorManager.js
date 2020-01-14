const Path = require('path');

const {registry:Targets, BlockCodeGenerator, CodeWriter} = require('@blockware/codegen');
const ClusterConfiguration = require('@blockware/local-cluster-config');
class CodeGeneratorManager {

    reload() {
        const providerDir = ClusterConfiguration.getProvidersBasedir();

        Targets.reset();
        Targets.load(providerDir);
    }

    canGenerateCode(yamlContent) {
        return yamlContent && yamlContent.kind.startsWith('blocks.blockware.com/');
    }

    async generate(yamlFile, yamlContent) {
        const baseDir = Path.dirname(yamlFile);
        console.log('Generating code for path: %s', baseDir);
        const codeGenerator = new BlockCodeGenerator(yamlContent);

        const output = await codeGenerator.generate();

        const writer = new CodeWriter(baseDir);

        writer.write(output);

        console.log('Code generated for path: %s', baseDir);
    }
}

module.exports = new CodeGeneratorManager();
module.exports.reload();