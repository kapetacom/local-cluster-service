import FS from "node:fs";
import YAML from "yaml";

export function readYML(path:string) {
    const rawYaml = FS.readFileSync(path);

    try {
        return YAML.parse(rawYaml.toString());
    } catch(err) {
        throw new Error('Failed to parse plan YAML: ' + err);
    }
}
