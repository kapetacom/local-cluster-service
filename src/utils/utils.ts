import FS from 'node:fs';
import YAML from 'yaml';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import md5 from 'md5';
import { EntityList } from '@kapeta/schemas';
import _ from 'lodash';
import { AnyMap } from '../types';

export function getBlockInstanceContainerName(systemId: string, instanceId: string) {
    return `kapeta-block-instance-${md5(systemId + instanceId)}`;
}

export function normalizeKapetaUri(uri: string) {
    if (!uri) {
        return '';
    }

    const uriObj = parseKapetaUri(uri);
    if (!uriObj.version) {
        return `kapeta://${parseKapetaUri(uri).fullName}`;
    }

    return `kapeta://${parseKapetaUri(uri).id}`;
}

export function readYML(path: string) {
    const rawYaml = FS.readFileSync(path);

    try {
        return YAML.parse(rawYaml.toString());
    } catch (err) {
        throw new Error(`Failed to parse plan YAML: ${err}`);
    }
}

export function isWindows() {
    return 'win32' === process.platform;
}

export function isMac() {
    return 'darwin' === process.platform;
}

export function isLinux() {
    return !isWindows() && !isMac();
}

export function getBindHost(preferredHost = '127.0.0.1') {
    // On Linux we need to bind to 0.0.0.0 to be able to connect to it from docker containers.
    // TODO: This might pose a security risk - so we should authenticate all requests using a shared secret/nonce that we pass around.
    return isLinux() ? '0.0.0.0' : preferredHost;
}

export function getResolvedConfiguration(entities?: EntityList, config?: AnyMap, globalConfiguration?: AnyMap): AnyMap {
    if (!entities || !globalConfiguration) {
        return config || {};
    }

    const mergedConfig = config ? _.cloneDeep(config) : {};
    entities.types?.forEach((type) => {
        if (!type.properties) {
            return;
        }
        Object.entries(type.properties).forEach(([propertyName, property]) => {
            if (!property.global) {
                return;
            }

            const configPath = type.name + '.' + propertyName;
            const defaultValue = globalConfiguration ? _.get(globalConfiguration, configPath) : undefined;
            if (!_.has(mergedConfig, configPath)) {
                _.set(mergedConfig, configPath, defaultValue);
            }
        });
    });

    return mergedConfig;
}
