const FS = require("node:fs");
const YAML = require("yaml");


exports.readYML = function readYML(path) {
    let rawYaml = FS.readFileSync(path);

    try {
        return YAML.parse(rawYaml.toString());
    } catch(err) {
        throw new Error('Failed to parse plan YAML: ' + err);
    }
}
