const AbstractSchemaHandler = require('./AbstractSchemaHandler');
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

        return [
            id,
            YAML.parse(FS.readFileSync(id).toString()),
        ];
    }

    async pack(id, ref, content) {
        if (!FS.existsSync(id)) {
            throw new Error('File not found: ' + id);
        }

        FS.writeFileSync(id, YAML.stringify(content));
    }

}

module.exports = FileSchemaHandler;