/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */
import {
    BlockInstanceDetails,
    ConfigProvider,
    DefaultCredentials,
    DefaultResourceOptions,
    InstanceOperator,
    ResourceInfo,
} from '@kapeta/sdk-config';
import { Definition, DefinitionInfo } from '@kapeta/local-cluster-config';
import { normalizeKapetaUri } from '@kapeta/nodejs-utils';
import { BlockDefinition, Plan } from '@kapeta/schemas';
import { configManager } from '../configManager';
import { AnyMap, EnvironmentType } from '../types';
import _ from 'lodash';
import { serviceManager } from '../serviceManager';
import { operatorManager } from '../operatorManager';
import { instanceManager } from '../instanceManager';
import { definitionsManager } from '../definitionsManager';
import { getBindAddressForEnvironment } from './utils';

/**
 * A configuration provider that does the same as the LocalConfigProvider
 * but without calling the API of the local cluster service (since it's running in the same process)
 */
export class InternalConfigProvider implements ConfigProvider {
    private readonly info: DefinitionInfo;
    private readonly systemId: string;
    private readonly instanceId: string;
    private readonly config: AnyMap;
    private readonly environment: EnvironmentType;

    constructor(
        systemId: string,
        instanceId: string,
        info: DefinitionInfo,
        config: AnyMap,
        environment: EnvironmentType = 'docker'
    ) {
        this.info = info;
        this.systemId = normalizeKapetaUri(systemId);
        this.instanceId = instanceId;
        this.config = config;
        this.environment = environment;
    }

    getBlockDefinition() {
        return this.info.definition;
    }
    getBlockReference(): string {
        return normalizeKapetaUri(this.info.definition.metadata.name + ':' + this.info.version);
    }
    getSystemId(): string {
        return this.systemId;
    }
    getInstanceId(): string {
        return this.instanceId;
    }
    getServerPort(portType?: string | undefined): Promise<string> {
        return serviceManager.ensureServicePort(this.systemId, this.instanceId, portType);
    }
    async getServiceAddress(serviceName: string, portType: string): Promise<string | null> {
        return serviceManager.getConsumerAddress(
            this.systemId,
            this.instanceId,
            serviceName,
            portType,
            this.environment
        );
    }
    getResourceInfo<Options = DefaultResourceOptions, Credentials = DefaultCredentials>(
        resourceType: string,
        portType: string,
        resourceName: string
    ): Promise<ResourceInfo<Options, Credentials> | null> {
        return operatorManager.getConsumerResourceInfo(
            this.systemId,
            this.instanceId,
            resourceType,
            portType,
            resourceName,
            this.environment,
            false
        );
    }
    async getInstanceHost(instanceId: string): Promise<string | null> {
        const instance = instanceManager.getInstance(this.systemId, instanceId);
        return instance?.address ?? null;
    }
    async getServerHost(): Promise<string> {
        return getBindAddressForEnvironment(this.environment);
    }
    getProviderId(): string {
        return 'internal';
    }
    getOrDefault<T = any>(path: string, defaultValue: T): T {
        return this.get(path) ?? defaultValue;
    }
    get<T = any>(path: string): T | undefined {
        return _.get(this.config, path);
    }

    getInstanceOperator<Options = any, Credentials extends DefaultCredentials = DefaultCredentials>(
        instanceId: string
    ): Promise<InstanceOperator<Options, Credentials> | null> {
        return instanceManager.getInstanceOperator(this.systemId, instanceId, this.environment, false);
    }

    public async getInstanceForConsumer<BlockType = BlockDefinition>(
        resourceName: string
    ): Promise<BlockInstanceDetails<BlockType> | null> {
        const plan = await this.getPlan();
        if (!plan) {
            throw new Error('Could not find plan');
        }
        const instanceId = this.getInstanceId();
        const connection = plan.spec.connections.find(
            (connection) =>
                connection.consumer.blockId === instanceId && connection.consumer.resourceName === resourceName
        );

        if (!connection) {
            throw new Error(`Could not find connection for consumer ${resourceName}`);
        }

        const instance = plan.spec.blocks.find((b) => b.id === connection.provider.blockId);

        if (!instance) {
            throw new Error(`Could not find instance ${connection.provider.blockId} in plan`);
        }

        const block = await this.getBlock(instance.block.ref);

        if (!block) {
            throw new Error(`Could not find block ${instance.block.ref} in plan`);
        }

        return {
            instanceId: connection.provider.blockId,
            connections: [connection],
            block: block as BlockType,
        };
    }

    public async getInstancesForProvider<BlockType = BlockDefinition>(
        resourceName: string
    ): Promise<BlockInstanceDetails<BlockType>[]> {
        const plan = await this.getPlan();
        if (!plan) {
            throw new Error('Could not find plan');
        }
        const instanceId = this.getInstanceId();

        const blockDetails: { [key: string]: BlockInstanceDetails<BlockType> } = {};
        const connections = plan.spec.connections.filter(
            (connection) =>
                connection.provider.blockId === instanceId && connection.provider.resourceName === resourceName
        );

        for (const connection of connections) {
            const blockInstanceId = connection.consumer.blockId;
            if (blockDetails[blockInstanceId]) {
                blockDetails[blockInstanceId].connections.push(connection);
                continue;
            }

            const instance = plan.spec.blocks.find((b) => b.id === blockInstanceId);
            if (!instance) {
                throw new Error(`Could not find instance ${blockInstanceId} in plan`);
            }

            const block = await this.getBlock(instance.block.ref);
            if (!block) {
                throw new Error(`Could not find block ${instance.block.ref} in plan`);
            }

            blockDetails[blockInstanceId] = {
                instanceId: blockInstanceId,
                connections: [connection],
                block: block as BlockType,
            };
        }

        return Object.values(blockDetails);
    }

    async getBlock(ref: any): Promise<Definition> {
        const definition = await definitionsManager.getDefinition(ref);
        if (!definition) {
            throw new Error(`Could not find definition for ${ref}`);
        }
        return definition.definition;
    }

    async getPlan(): Promise<Plan> {
        const definition = await definitionsManager.getDefinition(this.systemId);
        if (!definition) {
            throw new Error(`Could not find plan ${this.systemId}`);
        }
        return definition.definition as Plan;
    }
}

export async function createInternalConfigProvider(
    systemId: string,
    instanceId: string,
    info: DefinitionInfo
): Promise<InternalConfigProvider> {
    const config = await configManager.getConfigForBlockInstance(systemId, instanceId);
    return new InternalConfigProvider(systemId, instanceId, info, config);
}
