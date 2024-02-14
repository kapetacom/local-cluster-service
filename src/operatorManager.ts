/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { DefinitionInfo } from '@kapeta/local-cluster-config';
import Path from 'path';
import md5 from 'md5';
import { serviceManager } from './serviceManager';
import { storageService } from './storageService';
import {
    COMPOSE_LABEL_PROJECT,
    COMPOSE_LABEL_SERVICE,
    CONTAINER_LABEL_PORT_PREFIX,
    ContainerInfo,
    containerManager,
} from './containerManager';
import FSExtra from 'fs-extra';
import {
    AnyMap,
    EnvironmentType,
    KIND_BLOCK_OPERATOR,
    KIND_RESOURCE_OPERATOR,
    LocalImageOptions,
    OperatorInfo,
    StringMap,
} from './types';
import { BlockInstance, Resource } from '@kapeta/schemas';
import { definitionsManager } from './definitionsManager';
import { getBindHost, toPortInfo } from './utils/utils';
import { parseKapetaUri, normalizeKapetaUri } from '@kapeta/nodejs-utils';
import _ from 'lodash';
import AsyncLock from 'async-lock';
import { taskManager } from './taskManager';

const KIND_PLAN = 'core/plan';

class Operator {
    private readonly _data: DefinitionInfo;

    constructor(data: DefinitionInfo) {
        this._data = data;
    }

    getLocalData(): LocalImageOptions {
        return this._data.definition.spec.local;
    }

    getDefinitionInfo() {
        return this._data;
    }

    getCredentials() {
        return this._data.definition.spec.local.credentials;
    }
}

class OperatorManager {
    private _mountDir: string;

    private operatorLock: AsyncLock = new AsyncLock();

    constructor() {
        this._mountDir = Path.join(storageService.getKapetaBasedir(), 'mounts');

        FSExtra.mkdirpSync(this._mountDir);
    }

    _getMountPoint(operatorType: string, mountName: string) {
        return Path.join(this._mountDir, operatorType, mountName);
    }

    /**
     * Get operator definition for resource type
     */
    async getOperator(fullName: string, version: string) {
        const operators = await definitionsManager.getDefinitions([KIND_RESOURCE_OPERATOR, KIND_BLOCK_OPERATOR]);

        const operator: DefinitionInfo | undefined = operators.find(
            (operator) =>
                operator.definition &&
                operator.definition.metadata &&
                operator.definition.metadata.name &&
                operator.definition.metadata.name.toLowerCase() === fullName.toLowerCase() &&
                operator.version === version
        );

        if (!operator) {
            throw new Error(`Unknown operator type: ${fullName}:${version}`);
        }

        if (!operator.definition.spec || !operator.definition.spec.local) {
            throw new Error(`Operator missing local definition: ${fullName}:${version}`);
        }

        return new Operator(operator);
    }

    /**
     * Get information about a specific consumed resource
     */
    async getConsumerResourceInfo(
        systemId: string,
        fromServiceId: string,
        resourceType: string,
        portType: string,
        name: string,
        environment?: EnvironmentType
    ): Promise<OperatorInfo> {
        systemId = normalizeKapetaUri(systemId);
        const plans = await definitionsManager.getDefinitions(KIND_PLAN);

        const planUri = parseKapetaUri(systemId);
        const currentPlan = plans.find(
            (plan) => plan.definition.metadata.name === planUri.fullName && plan.version === planUri.version
        );
        if (!currentPlan) {
            throw new Error(`Unknown plan: ${systemId}`);
        }

        const currentInstance = currentPlan.definition.spec.blocks?.find(
            (instance: BlockInstance) => instance.id === fromServiceId
        );
        if (!currentInstance) {
            throw new Error(`Unknown instance: ${fromServiceId} in plan ${systemId}`);
        }

        const blockDefinition = await definitionsManager.getDefinition(currentInstance.block.ref);

        if (!blockDefinition) {
            throw new Error(`Unknown block: ${currentInstance.block.ref} in plan ${systemId}`);
        }

        const blockResource = blockDefinition.definition.spec?.consumers?.find((resource: Resource) => {
            if (resource.metadata.name !== name) {
                return false;
            }
            return parseKapetaUri(resource.kind).fullName === resourceType;
        });

        if (!blockResource) {
            throw new Error(`Unknown resource: ${name} in block ${currentInstance.block.ref} in plan ${systemId}`);
        }

        const kindUri = parseKapetaUri(blockResource.kind);
        const operator = await this.getOperator(resourceType, kindUri.version);
        const credentials = operator.getCredentials();
        const container = await this.ensureOperator(systemId, resourceType, kindUri.version);
        const portInfo = await container.getPort(portType);

        if (!portInfo) {
            throw new Error('Unknown resource port type : ' + resourceType + '#' + portType);
        }

        const dbName = name + '_' + fromServiceId.replace(/[^a-z0-9]/gi, '');
        const safeName = dbName.replace('_', '-');

        return {
            host: environment === 'docker' ? 'host.docker.internal' : '127.0.0.1',
            port: portInfo.hostPort,
            type: portType,
            protocol: portInfo.protocol,
            options: {
                // expose as fullName since that is not operator specific, but unique
                fullName: safeName,
                dbName,
            },
            credentials,
        };
    }

    /**
     * Ensure we have a running operator of given type
     *
     * @param systemId the plan ref
     * @param kind the full name - e.g. myhandle/rabbitmq
     * @param version the version of the operator
     */
    async ensureOperator(systemId: string, kind: string, version: string): Promise<ContainerInfo> {
        systemId = normalizeKapetaUri(systemId);

        const key = `${systemId}#${kind}:${version}`;

        return await this.operatorLock.acquire(key, async () => {
            const operator = await this.getOperator(kind, version);

            const operatorData = operator.getLocalData();

            const portTypes = Object.keys(operatorData.ports);

            portTypes.sort();

            const ports: AnyMap = {};

            for (let i = 0; i < portTypes.length; i++) {
                const portType = portTypes[i];
                let containerPortInfo = operatorData.ports[portType];
                const hostPort = await serviceManager.ensureServicePort(systemId, kind, portType);
                const portInfo = toPortInfo(containerPortInfo);
                const portId = portInfo.port + '/' + portInfo.type;

                ports[portId] = {
                    type: portType,
                    hostPort,
                };
            }

            const nameParts = [systemId, kind.toLowerCase(), version];

            const containerName = `kapeta-resource-${md5(nameParts.join('_'))}`;

            const PortBindings: { [key: string]: any } = {};
            const Env: string[] = [];

            const systemUri = parseKapetaUri(systemId);

            const Labels: StringMap = {
                kapeta: 'true',
                [COMPOSE_LABEL_PROJECT]: systemUri.id.replace(/[^a-z0-9]/gi, '_'),
                [COMPOSE_LABEL_SERVICE]: [kind, version].join('_').replace(/[^a-z0-9]/gi, '_'),
            };

            const operatorMetadata = operator.getDefinitionInfo().definition.metadata;

            const bindHost = getBindHost();

            const ExposedPorts: { [key: string]: any } = {};

            _.forEach(ports, (portInfo: any, containerPort) => {
                ExposedPorts['' + containerPort] = {};
                PortBindings['' + containerPort] = [
                    {
                        HostPort: '' + portInfo.hostPort,
                        HostIp: bindHost,
                    },
                ];

                Labels[CONTAINER_LABEL_PORT_PREFIX + portInfo.hostPort] = portInfo.type;
            });

            const Mounts = await containerManager.createVolumes(systemId, kind, operatorData.mounts);

            _.forEach(operatorData.env, (value, name) => {
                Env.push(name + '=' + value);
            });

            const task = taskManager.add(
                `operator:ensure:${key}`,
                async () => {
                    let HealthCheck = undefined;

                    if (operatorData.health) {
                        HealthCheck = containerManager.toDockerHealth(operatorData.health);
                    }

                    const container = await containerManager.ensureContainer({
                        name: containerName,
                        Image: operatorData.image,
                        Hostname: containerName + '.kapeta',
                        Labels,
                        Cmd: operatorData.cmd,
                        ExposedPorts,
                        Env,
                        HealthCheck,
                        HostConfig: {
                            PortBindings,
                            Mounts,
                        },
                    });

                    await containerManager.waitForReady(container);

                    return new ContainerInfo(container);
                },
                {
                    name: `Ensuring ${operatorMetadata.title ?? operatorMetadata.name}`,
                    systemId,
                }
            );

            return task.wait();
        });
    }
}

export const operatorManager = new OperatorManager();
