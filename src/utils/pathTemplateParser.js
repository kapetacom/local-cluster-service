
const TYPE_VARIABLE = 'variable';
const TYPE_PATH = 'path';

class PathTemplate {
    constructor(pathTemplate) {
        if (!pathTemplate.startsWith('/')) {
            pathTemplate = '/' + pathTemplate;
        }
        this._path = pathTemplate;

        this._parts = pathTemplate.split(/{/g).map((part) => {
            if (part.endsWith('}')) {
                let regex,
                    value = part.substr(0, part.length -  1);

                [value, regex] = value.split(/:/, 2);

                if (regex) {
                    regex = new RegExp('^' + regex);
                } else {
                    regex = /^[^\/]+/
                }

                return {
                    type: TYPE_VARIABLE,
                    value,
                    regex
                };
            }

            return {
                type: TYPE_PATH,
                value: part
            };
        });


    }

    get path() {
        return this._path;
    }

    matches(path) {
        return this.parse(path) !== null;
    }

    parse(path) {
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        const values = {};

        for(let i = 0 ; i < this._parts.length; i++) {
            const part = this._parts[i];
            switch (part.type) {
                case TYPE_PATH:
                    if (!path.startsWith(part.value)) {
                        return null;
                    }

                    path = path.substr(part.value.length);
                    break;
                case TYPE_VARIABLE:
                    if (!part.regex.test(path)) {
                        return null;
                    }

                    const newPath = path.replace(part.regex,'');
                    const value = path.substr(0, path.length - newPath.length);
                    values[part.value] = value;
                    path = newPath;
                    break;
            }
        }

        if (path && path !== '/') {
            //We did not match all of it
            return null;
        }

        return values;
    }

    create(variables) {
        return this._parts.map((part) => {
            switch (part.type) {
                case TYPE_PATH:
                    return part.value;
                case TYPE_VARIABLE:
                    if (variables[part.value] === undefined ||
                        variables[part.value] === null ) {
                        return ''
                    }

                    return variables[part.value];
            }
        }).join('');
    }

    toString() {
        return 'tmpl: ' + this.path
    }
}

/**
 * Parses a path into a RESTPath
 * @param {string} path
 */
function pathTemplateParser(path) {
    return new PathTemplate(path);
}

module.exports = pathTemplateParser;