class AbstractSchemaHandler {
    constructor(name) {
        this.name = name;
    }

    isEditable() {
        throw new Error('isEditable() not implemented for schema: ' + this.name);
    }

    async unpack(id, ref) {
        throw new Error('unpack() not implemented for schema: ' + this.name);
    }

    async pack(id, ref, content) {
        throw new Error('pack() not implemented for schema: ' + this.name);
    }
}

module.exports = AbstractSchemaHandler;