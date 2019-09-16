const Path = require('path');

const {registry:Targets, BlockCodeGenerator, CodeWriter} = require('@blockware/codegen');

//Hardcoded for now
Targets.register('targets.blockware.com/v1/java8-springboot2',
    require('@blockware/codegen-target-java8-springboot2'));

Targets.register('targets.blockware.com/v1/nodejs9',
    require('@blockware/codegen-target-nodejs9'));

const BLOCK_KINDS = [
    'core.blockware.com/v1/Block/Service'
];

class CodeGeneratorManager {

    canGenerateCode(yamlContent) {
        return yamlContent && BLOCK_KINDS.indexOf(yamlContent.kind) > -1;
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