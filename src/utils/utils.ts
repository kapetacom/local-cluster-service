/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import FS from 'node:fs';
import YAML from 'yaml';
import md5 from 'md5';
import { EntityList, LocalInstance, LocalInstancePort, LocalInstancePortType } from '@kapeta/schemas';
import _ from 'lodash';
import { AnyMap, DOCKER_HOST_INTERNAL, EnvironmentType, KIND_BLOCK_TYPE_OPERATOR } from '../types';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { definitionsManager } from '../definitionsManager';
import { normalizeKapetaUri, parseKapetaUri } from '@kapeta/nodejs-utils';
import { assetManager } from '../assetManager';
import { serviceManager } from '../serviceManager';
import { clusterService } from '../clusterService';

export async function getBlockInstanceContainerName(systemId: string, instanceId: string, blockType?: string) {
    if (!blockType) {
        const instance = await assetManager.getBlockInstance(systemId, instanceId);
        if (!instance) {
            throw new Error(`Instance ${instanceId} not found in plan ${systemId}`);
        }
        const block = await assetManager.getAsset(instance.block.ref);
        if (!block) {
            throw new Error(`Block ${instance.block.ref} not found`);
        }
        blockType = block.data.kind;
    }
    const typeDefinition = await definitionsManager.getDefinition(blockType);
    if (!typeDefinition) {
        throw new Error(`Block type ${blockType} not found`);
    }
    if (
        parseKapetaUri(typeDefinition.definition.kind).fullName === KIND_BLOCK_TYPE_OPERATOR &&
        typeDefinition.definition.spec?.local?.singleton
    ) {
        return `kapeta-instance-operator-${md5(normalizeKapetaUri(systemId) + normalizeKapetaUri(blockType))}`;
    }

    return `kapeta-block-instance-${md5(normalizeKapetaUri(systemId) + instanceId)}`;
}

export function toPortInfo(port: LocalInstancePort) {
    if (typeof port === 'number' || typeof port === 'string') {
        return { port: parseInt(`${port}`), type: 'tcp' };
    }

    if (!port.type) {
        port.type = LocalInstancePortType.TCP;
    }

    return port;
}

export async function getOperatorInstancePorts(systemId: string, operatorId: string, local: LocalInstance) {
    const localPorts = local.ports ?? {};

    const promises = Object.entries(localPorts).map(async ([portType, value]) => {
        const portInfo = toPortInfo(value);
        const hostPort = await serviceManager.ensureServicePort(systemId, operatorId, portType);
        return {
            portType,
            port: portInfo.port,
            hostPort,
            protocol: portInfo.type,
        };
    });
    return await Promise.all(promises);
}

/**
 * Gets the hostname where all services are available - including the cluster service.
 *
 * For docker this is the internal docker host - otherwise it's the local machine
 * Assumed to be the same address as the cluster service outside docker.
 */
export function getRemoteHostForEnvironment(environment: EnvironmentType | undefined): string {
    return environment === 'docker' ? DOCKER_HOST_INTERNAL : clusterService.getClusterServiceHost();
}

/**
 * Get the bind address for the given environment.
 *
 * Outside of docker we bind to 127.0.0.1 - inside we bind to everything (0.0.0.0)
 */
export function getBindAddressForEnvironment(
    environment: EnvironmentType | undefined,
    preferredHost = '127.0.0.1'
): string {
    return environment === 'docker' ? '0.0.0.0' : preferredHost;
}

/**
 * Get the docker host IP address for port binding.
 */
export function getDockerHostIp(preferredHost = '127.0.0.1') {
    // On Linux we need to bind to 0.0.0.0 to be able to connect to it from docker containers.
    // TODO: This might pose a security risk - so we should authenticate all requests using a shared secret/nonce that we pass around.
    return isLinux() ? '0.0.0.0' : preferredHost;
}

export function getRemoteUrl(id: string, defautValue: string) {
    const remoteConfig = ClusterConfiguration.getClusterConfig().remote;
    return remoteConfig?.[id] ?? defautValue;
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
