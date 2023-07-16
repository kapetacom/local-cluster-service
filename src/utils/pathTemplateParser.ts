import { StringMap } from '../types';

const TYPE_VARIABLE = 'variable';
const TYPE_PATH = 'path';

/**
 * A path template is a string that can be used to match a path and extract variables from it.
 *
 * E.g. /foo/{bar}/baz
 *
 * Would match /foo/123/baz and extract bar=123
 *
 * You can also specify a regex for the variable:
 *  /foo/{bar:[0-9]+}/baz
 *
 */
export class PathTemplate {
    private _path: string;
    private _parts: { type: 'variable' | 'path'; value: string; regex?: RegExp }[] = [];

    constructor(pathTemplate: string) {
        if (!pathTemplate.startsWith('/')) {
            pathTemplate = '/' + pathTemplate;
        }
        this._path = pathTemplate;

        const variableRegex = /{([^}]+)}/g;
        let match,
            offset = 0;
        this._parts = [];
        while ((match = variableRegex.exec(pathTemplate)) !== null) {
            if (match.index > offset) {
                this._parts.push({
                    type: TYPE_PATH,
                    value: pathTemplate.substring(offset, match.index),
                });
            }

            let regex;
            let value = match[1];
            [value, regex] = value.split(/:/, 2);

            if (regex) {
                regex = new RegExp('^' + regex);
            } else {
                regex = /^[^\/]+/;
            }

            this._parts.push({
                type: TYPE_VARIABLE,
                value,
                regex,
            });
            offset = match.index + match[0].length;
        }

        if (offset < pathTemplate.length) {
            this._parts.push({
                type: TYPE_PATH,
                value: pathTemplate.substring(offset),
            });
        }
    }

    get path() {
        return this._path;
    }

    matches(path: string) {
        return this.parse(path) !== null;
    }

    parse(path: string) {
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        const values: StringMap = {};

        for (let i = 0; i < this._parts.length; i++) {
            const part = this._parts[i];
            switch (part.type) {
                case TYPE_PATH:
                    if (!path.startsWith(part.value)) {
                        return null;
                    }

                    path = path.substring(part.value.length);
                    break;
                case TYPE_VARIABLE:
                    if (!part.regex?.test(path)) {
                        return null;
                    }

                    const newPath = path.replace(part.regex, '');
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

    create(variables: StringMap) {
        return this._parts
            .map((part) => {
                switch (part.type) {
                    case TYPE_PATH:
                        return part.value;
                    case TYPE_VARIABLE:
                        if (variables[part.value] === undefined || variables[part.value] === null) {
                            return '';
                        }

                        return variables[part.value];
                }
            })
            .join('');
    }

    toString() {
        return 'tmpl: ' + this.path;
    }
}

/**
 * Parses a path into a RESTPath
 */
export function pathTemplateParser(path: string) {
    return new PathTemplate(path);
}
