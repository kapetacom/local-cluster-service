class AbstractSchemaHandler {
    constructor(name) {
        this.name = name;
    }

    isEditable() {
        throw new Error('isEditable() implemented for schema: ' + this.name);
    }

    async unpack(id, ref) {
        throw new Error('read() implemented for schema: ' + this.name);
    }
}

module.exports = AbstractSchemaHandler;