const AbstractSchemaHandler = require('./AbstractSchemaHandler');
const PlanKindHandler = require('../kind-handlers/PlanKindHandler');
const FS = require('fs');
const YAML = require('yaml');

class FileSchemaHandler extends AbstractSchemaHandler {

    constructor() {
        super('file');
    }

    isEditable(id, ref) {
        return true;
    }

    async unpack(id, ref) {
        if (!FS.existsSync(id)) {
            throw new Error('File not found: ' + id);
        }

        let content = YAML.parse(FS.readFileSync(id).toString());

        if (content && PlanKindHandler.isKind(content.kind)) {
            content = PlanKindHandler.resolveAbsoluteFileRefs(id, content);
        }

        return [
            id,
            content
        ];
    }

    async pack(path, ref, content) {
        if (!FS.existsSync(path)) {
            throw new Error('File not found: ' + path);
        }

        if (content && PlanKindHandler.isKind(content.kind)) {
            content = PlanKindHandler.resolveRelativeFileRefs(path, content);
        }

        FS.writeFileSync(path, YAML.stringify(content));

        return path;
    }

}

module.exports = FileSchemaHandler;