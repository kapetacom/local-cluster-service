const AbstractSchemaHandler = require('./AbstractSchemaHandler');
const FileSchemaHandler = require('./FileSchemaHandler');

const SchemaHandlers = {
    file: new FileSchemaHandler(),
    github: new AbstractSchemaHandler('github'),
    blockware: new AbstractSchemaHandler('blockware'),
    http: new AbstractSchemaHandler('http'),
    https: new AbstractSchemaHandler('https'),
    get: function(id) {
        if (!this[id]) {
            throw new Error('Schema not supported: ' + id);
        }

        return this[id];
    }
};

module.exports = SchemaHandlers;