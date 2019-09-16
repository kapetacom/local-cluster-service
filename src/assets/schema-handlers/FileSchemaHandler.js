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

    async pack(path, ref, content) {
        if (!FS.existsSync(path)) {
            throw new Error('File not found: ' + path);
        }

        FS.writeFileSync(path, YAML.stringify(content));

        return path;
    }

}

module.exports = FileSchemaHandler;