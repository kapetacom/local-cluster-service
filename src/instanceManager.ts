/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import _ from 'lodash';
import request from 'request';
import AsyncLock from 'async-lock';
import { BlockInstanceRunner } from './utils/BlockInstanceRunner';
import { storageService } from './storageService';
import { EVENT_INSTANCE_CREATED, EVENT_STATUS_CHANGED, socketManager } from './socketManager';
import { serviceManager } from './serviceManager';
import { assetManager, EnrichedAsset } from './assetManager';
import {
    containerManager,
    DockerContainerHealth,
    DockerContainerStatus,
    HEALTH_CHECK_TIMEOUT,
} from './containerManager';
import { configManager } from './configManager';
import {
    DesiredInstanceStatus,
    EnvironmentType,
    InstanceInfo,
    InstanceOwner,
    InstanceStatus,
    InstanceType,
    KIND_BLOCK_TYPE_EXECUTABLE,
    KIND_BLOCK_TYPE_OPERATOR,
    KIND_RESOURCE_OPERATOR,
    LogEntry,
} from './types';
import { BlockDefinitionSpec, LocalInstance, Plan } from '@kapeta/schemas';
import {
    getBlockInstanceContainerName,
    getOperatorInstancePorts,
    getRemoteHostForEnvironment,
    getResolvedConfiguration,
} from './utils/utils';
import { operatorManager } from './operatorManager';
import { normalizeKapetaUri, parseKapetaUri } from '@kapeta/nodejs-utils';
import { definitionsManager } from './definitionsManager';
import { Task, taskManager } from './taskManager';
import { InstanceOperator, InstanceOperatorPort } from '@kapeta/sdk-config';

const CHECK_INTERVAL = 5000;
const DEFAULT_HEALTH_PORT_TYPE = 'http';

const MIN_TIME_RUNNING = 30000; //If something didnt run for more than 30 secs - it failed

export class InstanceManager {
    private _interval: any = undefined;

    private readonly _instances: InstanceInfo[] = [];

    private readonly instanceLocks: AsyncLock = new AsyncLock();

    constructor() {
        this._instances = storageService.section('instances', []);

        // We need to wait a bit before running the first check
        this.checkInstancesLater(1000);
    }

    private checkInstancesLater(time = CHECK_INTERVAL) {
        if (this._interval) {
            clearTimeout(this._interval);
        }

        this._interval = setTimeout(async () => {
            await this.checkInstances();
            this.checkInstancesLater();
        }, time);
    }

    public getInstances() {
        if (!this._instances) {
            return [];
        }

        return [...this._instances];
    }

    public async getInstancesForPlan(systemId: string) {
        if (!this._instances) {
            return [];
        }

        systemId = normalizeKapetaUri(systemId);

        const planInfo = await definitionsManager.getDefinition(systemId);

        if (!planInfo) {
            return [];
        }

        const plan = planInfo.definition as Plan;
        if (!plan?.spec?.blocks) {
            return [];
        }

        const instanceIds = plan.spec?.blocks?.map((block) => block.id) || [];

        return this._instances.filter(
            (instance) => instance.systemId === systemId && instanceIds.includes(instance.instanceId)
        );
    }

    public getInstance(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);

        return this._instances.find((i) => i.systemId === systemId && i.instanceId === instanceId);
    }

    private async exclusive<T = any>(systemId: string, instanceId: string, fn: () => Promise<T>) {
        systemId = normalizeKapetaUri(systemId);
        const key = `${systemId}/${instanceId}`;
        //console.log(`Acquiring lock for ${key}`, this.instanceLocks.isBusy(key));
        const result = await this.instanceLocks.acquire(key, fn);
        //console.log(`Releasing lock for ${key}`, this.instanceLocks.isBusy(key));
        return result;
    }

    private isLocked(systemId: string, instanceId: string) {
        return this.instanceLocks.isBusy(`${systemId}/${instanceId}`);
    }

    public async getLogs(systemId: string, instanceId: string): Promise<LogEntry[]> {
        const instance = this.getInstance(systemId, instanceId);
        if (!instance) {
            throw new Error(`Instance ${systemId}/${instanceId} not found`);
        }

        switch (instance.type) {
            case InstanceType.DOCKER:
                return await containerManager.getLogs(instance);

            case InstanceType.UNKNOWN:
                return [
                    {
                        level: 'INFO',
                        message: 'Instance is starting...',
                        time: Date.now(),
                        source: 'stdout',
                    },
                ];

            case InstanceType.LOCAL:
                return [
                    {
                        level: 'INFO',
                        message: 'Instance started outside Kapeta - logs not available...',
                        time: Date.now(),
                        source: 'stdout',
                    },
                ];
        }

        return [];
    }

    public async saveInternalInstance(instance: InstanceInfo) {
        instance.systemId = normalizeKapetaUri(instance.systemId);
        if (instance.ref) {
            instance.ref = normalizeKapetaUri(instance.ref);
        }

        //Get target address
        let address = await serviceManager.getProviderAddress(
            instance.systemId,
            instance.instanceId,
            instance.portType ?? DEFAULT_HEALTH_PORT_TYPE
        );

        const healthUrl = this.getHealthUrl(instance, address);

        instance.address = address;
        if (healthUrl) {
            instance.health = healthUrl;
        }

        let existingInstance = this.getInstance(instance.systemId, instance.instanceId);
        if (existingInstance) {
            const ix = this._instances.indexOf(existingInstance);
            this._instances.splice(ix, 1, instance);
            socketManager.emitSystemEvent(instance.systemId, EVENT_STATUS_CHANGED, instance);
        } else {
            this._instances.push(instance);
            socketManager.emitSystemEvent(instance.systemId, EVENT_INSTANCE_CREATED, instance);
        }

        this.save();

        return instance;
    }

    /**
     * Method is called when instance is started from the Kapeta SDKs (e.g. NodeJS SDK)
     * which self-registers with the cluster service locally on startup.
     */
    public async registerInstanceFromSDK(
        systemId: string,
        instanceId: string,
        info: Omit<InstanceInfo, 'systemId' | 'instanceId'>
    ) {
        return this.exclusive(systemId, instanceId, async () => {
            systemId = normalizeKapetaUri(systemId);

            let instance = this.getInstance(systemId, instanceId);

            //Get target address
            const address = await serviceManager.getProviderAddress(
                systemId,
                instanceId,
                info.portType ?? DEFAULT_HEALTH_PORT_TYPE
            );

            const healthUrl = this.getHealthUrl(info, address);

            if (instance) {
                if (
                    instance.status === InstanceStatus.STOPPING &&
                    instance.desiredStatus === DesiredInstanceStatus.STOP
                ) {
                    //If instance is stopping do not interfere
                    return;
                }

                if (info.owner === InstanceOwner.EXTERNAL) {
                    //If instance was started externally - then we want to replace the internal instance with that
                    if (
                        instance.owner === InstanceOwner.INTERNAL &&
                        (instance.status === InstanceStatus.READY ||
                            instance.status === InstanceStatus.STARTING ||
                            instance.status === InstanceStatus.UNHEALTHY)
                    ) {
                        throw new Error(`Instance ${instanceId} is already running`);
                    }

                    instance.desiredStatus = info.desiredStatus;
                    instance.owner = info.owner;
                    instance.status = InstanceStatus.STARTING;
                    instance.startedAt = Date.now();
                }

                instance.pid = info.pid;
                instance.address = address;
                if (info.type) {
                    instance.type = info.type;
                }

                if (healthUrl) {
                    instance.health = healthUrl;
                }

                if (info.portType) {
                    instance.portType = info.portType;
                }

                socketManager.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
            } else {
                //If instance was not found - then we're receiving an externally started instance
                instance = {
                    ...info,
                    systemId,
                    instanceId,
                    status: InstanceStatus.STARTING,
                    startedAt: Date.now(),
                    desiredStatus: DesiredInstanceStatus.EXTERNAL,
                    owner: InstanceOwner.EXTERNAL,
                    health: healthUrl,
                    address,
                };

                this._instances.push(instance);

                socketManager.emitSystemEvent(systemId, EVENT_INSTANCE_CREATED, instance);
            }

            this.save();

            return instance;
        });
    }

    private getHealthUrl(info: Omit<InstanceInfo, 'systemId' | 'instanceId'>, address: string) {
        let healthUrl = null;
        let health = info.health ?? '/.kapeta/health';
        if (health) {
            if (health.startsWith('/')) {
                health = health.substring(1);
            }
            healthUrl = address + health;
        }
        return healthUrl;
    }

    public markAsStopped(systemId: string, instanceId: string) {
        return this.exclusive(systemId, instanceId, async () => {
            systemId = normalizeKapetaUri(systemId);
            const instance = _.find(this._instances, { systemId, instanceId });
            if (instance && instance.owner === InstanceOwner.EXTERNAL && instance.status !== InstanceStatus.STOPPED) {
                if (instance.status != InstanceStatus.FAILED) {
                    instance.status = InstanceStatus.STOPPED;
                }
                instance.pid = null;
                instance.health = null;
                socketManager.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
                this.save();
            }
        });
    }

    public async startAllForPlan(systemId: string): Promise<Task<InstanceInfo[]>> {
        systemId = normalizeKapetaUri(systemId);
        const plan = await assetManager.getPlan(systemId, true);
        if (!plan) {
            throw new Error(`Plan not found: ${systemId}`);
        }

        if (!plan.spec.blocks) {
            throw new Error(`No blocks found in plan: ${systemId}`);
        }

        return taskManager.add(
            `plan:start:${systemId}`,
            async () => {
                const promises: Promise<InstanceInfo>[] = [];
                const errors = [];
                const instanceIds = await this.getAllInstancesExceptKind(systemId, KIND_BLOCK_TYPE_EXECUTABLE);
                for (const instanceId of instanceIds) {
                    try {
                        promises.push(
                            this.start(systemId, instanceId).then((taskOrInstance) => {
                                if (taskOrInstance instanceof Task) {
                                    return taskOrInstance.wait();
                                }
                                return taskOrInstance;
                            })
                        );
                    } catch (e) {
                        errors.push(e);
                    }
                }

                const settled = await Promise.allSettled(promises);

                if (errors.length > 0) {
                    throw errors[0];
                }

                return settled
                    .map((p) => (p.status === 'fulfilled' ? p.value : null))
                    .filter((p) => !!p) as InstanceInfo[];
            },
            {
                name: `Starting plan ${systemId}`,
            }
        );
    }

    public stopAllForPlan(systemId: string) {
        systemId = normalizeKapetaUri(systemId);
        const instancesForPlan = this._instances.filter((instance) => instance.systemId === systemId);
        return taskManager.add(
            `plan:stop:${systemId}`,
            async () => {
                return this.stopInstances(instancesForPlan);
            },
            {
                name: `Stopping plan ${systemId}`,
            }
        );
    }

    public async getInstanceOperator(
        systemId: string,
        instanceId: string,
        environment?: EnvironmentType,
        ensureContainer: boolean = true
    ): Promise<InstanceOperator<any, any>> {
        const blockInstance = await assetManager.getBlockInstance(systemId, instanceId);
        if (!blockInstance) {
            throw new Error(`Instance not found: ${systemId}/${instanceId}`);
        }
        const blockRef = normalizeKapetaUri(blockInstance.block.ref);
        const block = await assetManager.getAsset(blockRef, true);
        if (!block) {
            throw new Error(`Block not found: ${blockRef}`);
        }

        const operatorDefinition = await definitionsManager.getDefinition(block.kind);

        if (!operatorDefinition) {
            throw new Error(`Operator not found: ${block.kind}`);
        }

        if (operatorDefinition.definition.kind !== KIND_BLOCK_TYPE_OPERATOR) {
            throw new Error(`Block is not an operator: ${blockRef}`);
        }

        if (!operatorDefinition.definition.spec.local) {
            throw new Error(`Operator block has no local definition: ${blockRef}`);
        }

        const localConfig = operatorDefinition.definition.spec.local as LocalInstance;
        const ports: { [key: string]: InstanceOperatorPort } = {};

        if (ensureContainer) {
            let instance = await this.start(systemId, instanceId);
            if (instance instanceof Task) {
                instance = await instance.wait();
            }

            const container = await containerManager.get(instance.pid as string);
            if (!container) {
                throw new Error(`Container not found: ${instance.pid}`);
            }

            const portInfo = await container.getPorts();
            if (!portInfo) {
                throw new Error(`No ports found for instance: ${instanceId}`);
            }

            Object.entries(portInfo).forEach(([key, value]) => {
                ports[key] = {
                    protocol: value.protocol as 'udp' | 'tcp',
                    port: parseInt(value.hostPort),
                };
            });
        } else {
            // If we're not ensuring the container is running we just get the ports from the local config
            const instancePorts = await getOperatorInstancePorts(systemId, instanceId, localConfig);
            instancePorts.forEach((port) => {
                ports[port.portType] = {
                    protocol: port.protocol as 'udp' | 'tcp',
                    port: port.hostPort,
                };
            });
        }

        const hostname = getRemoteHostForEnvironment(environment);

        return {
            hostname,
            ports,
            credentials: localConfig.credentials,
            options: localConfig.options,
        };
    }

    public async stop(systemId: string, instanceId: string) {
        return this.stopInner(systemId, instanceId, true);
    }

    private async stopInner(
        systemId: string,
        instanceId: string,
        changeDesired: boolean = false,
        checkForSingleton: boolean = true
    ) {
        if (checkForSingleton) {
            const blockInstance = await assetManager.getBlockInstance(systemId, instanceId);
            const blockRef = normalizeKapetaUri(blockInstance.block.ref);

            const blockAsset = await assetManager.getAsset(blockRef, true);
            if (!blockAsset) {
                throw new Error('Block not found: ' + blockRef);
            }

            if (await this.isSingletonOperator(blockAsset)) {
                const instances = await this.getAllInstancesForKind(systemId, blockAsset.data.kind);
                if (instances.length > 1) {
                    const promises = instances.map((id) => {
                        return this.stopInner(systemId, id, changeDesired, false);
                    });

                    await Promise.all(promises);
                    return;
                }
            }
        }

        return this.exclusive(systemId, instanceId, async () => {
            systemId = normalizeKapetaUri(systemId);
            const instance = this.getInstance(systemId, instanceId);
            if (!instance) {
                return;
            }

            if (instance.status === InstanceStatus.STOPPED) {
                return;
            }

            if (instance.status === InstanceStatus.STOPPING) {
                return;
            }

            if (changeDesired && instance.desiredStatus !== DesiredInstanceStatus.EXTERNAL) {
                instance.desiredStatus = DesiredInstanceStatus.STOP;
            }

            const wasFailed = instance.status === InstanceStatus.FAILED;

            instance.status = InstanceStatus.STOPPING;

            socketManager.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
            console.log(
                'Stopping instance: %s::%s [desired: %s] [intentional: %s]',
                systemId,
                instanceId,
                instance.desiredStatus,
                changeDesired
            );
            this.save();

            try {
                if (instance.type === 'docker') {
                    const containerName = await getBlockInstanceContainerName(instance.systemId, instance.instanceId);
                    const container = await containerManager.getContainerByName(containerName);
                    if (container) {
                        try {
                            if (wasFailed) {
                                await container.remove();
                            } else {
                                await container.stop();
                            }
                            instance.status = InstanceStatus.STOPPED;
                            socketManager.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
                            this.save();
                        } catch (e) {
                            console.error('Failed to stop container', e);
                        }
                    } else {
                        console.warn('Container not found', containerName);
                    }
                    return;
                }

                if (!instance.pid) {
                    instance.status = InstanceStatus.STOPPED;
                    this.save();
                    return;
                }

                process.kill(instance.pid as number, 'SIGTERM');
                instance.status = InstanceStatus.STOPPED;
                socketManager.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
                this.save();
            } catch (e) {
                console.error('Failed to stop process', e);
            }
        });
    }

    public async start(
        systemId: string,
        instanceId: string,
        checkForSingleton: boolean = true
    ): Promise<InstanceInfo | Task<InstanceInfo>> {
        systemId = normalizeKapetaUri(systemId);
        const blockInstance = await assetManager.getBlockInstance(systemId, instanceId);
        const blockRef = normalizeKapetaUri(blockInstance.block.ref);

        const blockAsset = await assetManager.getAsset(blockRef, true);
        if (!blockAsset) {
            throw new Error('Block not found: ' + blockRef);
        }

        if (checkForSingleton && (await this.isSingletonOperator(blockAsset))) {
            const instances = await this.getAllInstancesForKind(systemId, blockAsset.data.kind);
            if (instances.length > 1) {
                const promises = instances.map((id) => {
                    return this.start(systemId, id, false);
                });

                await Promise.all(promises);
                return promises[0];
            }
        }

        return this.exclusive(systemId, instanceId, async () => {
            let existingInstance = this.getInstance(systemId, instanceId);

            if (existingInstance && existingInstance.pid) {
                const container = await containerManager.get(existingInstance.pid as string);
                if (!container) {
                    // The container is not running
                    existingInstance = undefined;
                }
            }

            if (existingInstance && existingInstance.pid) {
                if (existingInstance.status === InstanceStatus.READY) {
                    // Instance is already running
                    return existingInstance;
                }

                if (
                    existingInstance.desiredStatus === DesiredInstanceStatus.RUN &&
                    existingInstance.status === InstanceStatus.STARTING
                ) {
                    // Internal instance is already starting - don't start it again
                    return existingInstance;
                }

                if (
                    existingInstance.owner === InstanceOwner.EXTERNAL &&
                    existingInstance.status === InstanceStatus.STARTING
                ) {
                    // External instance is already starting - don't start it again
                    return existingInstance;
                }
            }

            let instance: InstanceInfo = {
                systemId,
                instanceId,
                ref: blockRef,
                name: blockAsset.data.metadata.name,
                desiredStatus: DesiredInstanceStatus.RUN,
                owner: InstanceOwner.INTERNAL,
                type: existingInstance?.type ?? InstanceType.UNKNOWN,
                status: InstanceStatus.STARTING,
                startedAt: Date.now(),
            };

            console.log('Starting instance: %s::%s [desired: %s]', systemId, instanceId, instance.desiredStatus);
            // Save the instance before starting it, so that we can track the status
            await this.saveInternalInstance(instance);

            const blockSpec = blockAsset.data.spec as BlockDefinitionSpec;
            if (blockSpec.consumers) {
                const promises = blockSpec.consumers.map(async (consumer) => {
                    const consumerUri = parseKapetaUri(consumer.kind);
                    const asset = await definitionsManager.getDefinition(consumer.kind);
                    if (!asset) {
                        // Definition not found
                        return Promise.resolve();
                    }

                    if (KIND_RESOURCE_OPERATOR.toLowerCase() !== asset.definition.kind.toLowerCase()) {
                        // Not an operator
                        return Promise.resolve();
                    }
                    // Check if the operator has a local definition, if not we skip it since we can't start it
                    if (!asset.definition.spec.local) {
                        console.log('Skipping operator since it as no local definition: %s', consumer.kind);
                        return Promise.resolve();
                    }
                    console.log('Ensuring resource: %s in %s', consumerUri.id, systemId);
                    return operatorManager.ensureOperator(systemId, consumerUri.fullName, consumerUri.version);
                });

                await Promise.all(promises);
            }

            if (existingInstance) {
                // Check if the instance is already running - but after we've commmuicated the desired status
                const currentStatus = await this.requestInstanceStatus(existingInstance);

                if (currentStatus === InstanceStatus.READY) {
                    // Instance is already running
                    return existingInstance;
                }
            }

            const resolvedConfig = await configManager.getConfigForBlockInstance(systemId, instanceId);

            const task = taskManager.add(
                `instance:start:${systemId}:${instanceId}`,
                async () => {
                    const runner = new BlockInstanceRunner(systemId);
                    const startTime = Date.now();
                    try {
                        const processInfo = await runner.start(blockRef, instanceId, resolvedConfig);

                        instance.status = InstanceStatus.STARTING;

                        return this.saveInternalInstance({
                            ...instance,
                            type: processInfo.type,
                            pid: processInfo.pid ?? -1,
                            health: null,
                            portType: processInfo.portType,
                            status: InstanceStatus.STARTING,
                        });
                    } catch (e: any) {
                        console.warn('Failed to start instance: ', systemId, instanceId, blockRef, e);
                        const logs: LogEntry[] = [
                            {
                                source: 'stdout',
                                level: 'ERROR',
                                message: e.message,
                                time: Date.now(),
                            },
                        ];

                        const out = await this.saveInternalInstance({
                            ...instance,
                            type: InstanceType.DOCKER,
                            health: null,
                            portType: DEFAULT_HEALTH_PORT_TYPE,
                            status: InstanceStatus.FAILED,
                            errorMessage: e.message ?? 'Failed to start - Check logs for details.',
                        });

                        socketManager.emitInstanceLog(systemId, instanceId, logs[0]);

                        return out;
                    }
                },
                {
                    name: `Starting instance: ${instance.name}`,
                    systemId,
                }
            );

            return task;
        });
    }

    /**
     * Stops an instance but does not remove it from the list of active instances
     *
     * It will be started again next time the system checks the status of the instance
     *
     * We do it this way to not cause the user to wait for the instance to start again
     */
    public async prepareForRestart(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);

        console.log('Stopping instance during restart...', systemId, instanceId);
        await this.stopInner(systemId, instanceId);
    }

    public async stopAll() {
        return this.stopInstances(this._instances);
    }

    private async stopInstances(instances: InstanceInfo[]) {
        const promises = instances.map((instance) => this.stop(instance.systemId, instance.instanceId));
        await Promise.allSettled(promises);
        this.save();
    }

    private save() {
        try {
            storageService.put(
                'instances',
                this._instances.map((instance) => {
                    return { ...instance };
                })
            );
        } catch (e) {
            console.error('Failed to save instances', this._instances, e);
        }
    }

    private async checkInstances() {
        //console.log('\n## Checking instances:');
        let changed = false;
        const all = [...this._instances];
        while (all.length > 0) {
            // Check a few instances at a time - docker doesn't like too many concurrent requests
            const chunk = all.splice(0, 30);
            const promises = chunk.map(async (oldInstance) => {
                if (!oldInstance.systemId) {
                    return;
                }

                // Grab the latest here
                const instance = this.getInstance(oldInstance.systemId, oldInstance.instanceId);
                if (!instance) {
                    return;
                }

                instance.systemId = normalizeKapetaUri(instance.systemId);
                if (instance.ref) {
                    instance.ref = normalizeKapetaUri(instance.ref);
                }

                if (instance.desiredStatus === DesiredInstanceStatus.RUN) {
                    // Check if the plan still exists and the instance is still in the plan
                    // - and that the block definition exists
                    try {
                        const plan = await assetManager.getAsset(instance.systemId, true, false);
                        if (!plan) {
                            console.log('Plan not found - reset to stop', instance.ref, instance.systemId);
                            instance.desiredStatus = DesiredInstanceStatus.STOP;
                            changed = true;
                            return;
                        }

                        const planData = plan.data as Plan;
                        const planInstance = planData?.spec?.blocks?.find((b) => b.id === instance.instanceId);
                        if (!planInstance || !planInstance?.block?.ref) {
                            console.log('Plan instance not found - reset to stop', instance.ref, instance.systemId);
                            instance.desiredStatus = DesiredInstanceStatus.STOP;
                            changed = true;
                            return;
                        }

                        const blockDef = await assetManager.getAsset(instance.ref, true, false);
                        if (!blockDef) {
                            console.log('Block definition not found - reset to stop', instance.ref, instance.systemId);
                            instance.desiredStatus = DesiredInstanceStatus.STOP;
                            changed = true;
                            return;
                        }
                    } catch (e) {
                        console.warn('Failed to check assets', instance.systemId, e);
                        instance.desiredStatus = DesiredInstanceStatus.STOP;
                        return;
                    }
                }

                const newStatus = await this.requestInstanceStatus(instance);
                /*
                console.log('Check instance %s %s: [current: %s, new: %s, desired: %s]',
                    instance.systemId, instance.instanceId, instance.status, newStatus, instance.desiredStatus);
                */

                if (newStatus === InstanceStatus.BUSY) {
                    // If instance is busy we skip it
                    //console.log('Instance %s %s is busy', instance.systemId, instance.instanceId);
                    return;
                }

                if (
                    instance.startedAt !== undefined &&
                    newStatus === InstanceStatus.UNHEALTHY &&
                    instance.startedAt + HEALTH_CHECK_TIMEOUT < Date.now() &&
                    instance.status === InstanceStatus.STARTING
                ) {
                    // If instance is starting we consider unhealthy an indication
                    // that it is still starting
                    //console.log('Instance %s %s is still starting', instance.systemId, instance.instanceId);
                    return;
                }

                if (instance.status !== newStatus) {
                    const oldStatus = instance.status;
                    const skipUpdate =
                        ([InstanceStatus.READY, InstanceStatus.UNHEALTHY].includes(newStatus) &&
                            instance.status === InstanceStatus.STOPPING) ||
                        (newStatus === InstanceStatus.STOPPED &&
                            instance.status === InstanceStatus.STARTING &&
                            instance.desiredStatus === DesiredInstanceStatus.RUN);

                    if (!skipUpdate) {
                        const oldStatus = instance.status;
                        instance.status = newStatus;
                        console.log(
                            'Instance status changed: %s %s: %s -> %s',
                            instance.systemId,
                            instance.instanceId,
                            oldStatus,
                            instance.status
                        );
                        socketManager.emitSystemEvent(instance.systemId, EVENT_STATUS_CHANGED, instance);
                        changed = true;
                    }
                }

                if (
                    instance.desiredStatus === DesiredInstanceStatus.RUN &&
                    [InstanceStatus.STOPPED, InstanceStatus.STOPPING].includes(newStatus)
                ) {
                    //If the instance is stopped but we want it to run, start it
                    try {
                        await this.start(instance.systemId, instance.instanceId);
                    } catch (e: any) {
                        console.warn(
                            'Failed to start previously stopped instance',
                            instance.systemId,
                            instance.instanceId,
                            e
                        );
                    }
                    return;
                }

                if (
                    instance.desiredStatus === DesiredInstanceStatus.STOP &&
                    [InstanceStatus.READY, InstanceStatus.STARTING, InstanceStatus.UNHEALTHY].includes(newStatus)
                ) {
                    //If the instance is running but we want it to stop, stop it
                    try {
                        console.log(
                            'Stopping instance since it is its desired state',
                            instance.systemId,
                            instance.instanceId
                        );
                        await this.stopInner(instance.systemId, instance.instanceId);
                    } catch (e) {
                        console.warn('Failed to stop instance', instance.systemId, instance.instanceId, e);
                    }
                    return;
                }

                if (
                    instance.desiredStatus === DesiredInstanceStatus.RUN &&
                    instance.status !== newStatus &&
                    newStatus === InstanceStatus.UNHEALTHY
                ) {
                    //If the instance is unhealthy, try to restart it
                    console.log('Restarting unhealthy instance', instance);
                    try {
                        await this.prepareForRestart(instance.systemId, instance.instanceId);
                    } catch (e) {
                        console.warn('Failed to restart instance', instance.systemId, instance.instanceId, e);
                    }
                }
            });

            await Promise.allSettled(promises);
        }

        if (changed) {
            this.save();
        }

        //console.log('\n##\n');
    }

    private async getExternalStatus(instance: InstanceInfo): Promise<InstanceStatus> {
        if (instance.type === InstanceType.DOCKER) {
            const containerName = await getBlockInstanceContainerName(instance.systemId, instance.instanceId);
            const container = await containerManager.getContainerByName(containerName);
            if (!container) {
                // If the container doesn't exist, we consider the instance stopped
                return InstanceStatus.STOPPED;
            }
            const state = await container.status();
            if (!state) {
                return InstanceStatus.STOPPED;
            }

            const statusType = state.Status as DockerContainerStatus;

            if (statusType === 'running') {
                if (state.Health?.Status) {
                    const healthStatusType = state.Health.Status as DockerContainerHealth;
                    if (healthStatusType === 'healthy' || healthStatusType === 'none') {
                        return InstanceStatus.READY;
                    }

                    if (healthStatusType === 'starting') {
                        return InstanceStatus.STARTING;
                    }

                    if (healthStatusType === 'unhealthy') {
                        return InstanceStatus.UNHEALTHY;
                    }
                }
                return InstanceStatus.READY;
            }

            if (statusType === 'created') {
                if (state.ExitCode !== undefined && state.ExitCode !== 0) {
                    // Failed during creation. Exit code is not always reliable though
                    if (state.Error) {
                        return InstanceStatus.FAILED;
                    } else {
                        return InstanceStatus.STOPPED;
                    }
                }
                return InstanceStatus.STARTING;
            }

            if (statusType === 'exited' || statusType === 'dead') {
                if (!state.Error) {
                    // Exit code is not always reliable - if there is no error we assume it's stopped
                    return InstanceStatus.STOPPED;
                }
                return InstanceStatus.FAILED;
            }

            if (statusType === 'removing') {
                return InstanceStatus.BUSY;
            }

            if (statusType === 'restarting') {
                return InstanceStatus.BUSY;
            }

            if (statusType === 'paused') {
                return InstanceStatus.BUSY;
            }

            return InstanceStatus.STOPPED;
        }

        if (!instance.pid) {
            return InstanceStatus.STOPPED;
        }

        //Otherwise its just a normal process.
        //TODO: Handle for Windows
        try {
            if (process.kill(instance.pid as number, 0)) {
                return InstanceStatus.READY;
            }
        } catch (err: any) {
            if (err.code === 'EPERM') {
                return InstanceStatus.READY;
            }
        }

        return InstanceStatus.STOPPED;
    }

    private async requestInstanceStatus(instance: InstanceInfo): Promise<InstanceStatus> {
        const externalStatus = await this.getExternalStatus(instance);
        if (instance.type === InstanceType.DOCKER) {
            // For docker instances we can rely on docker status
            return externalStatus;
        }

        if (externalStatus === InstanceStatus.STOPPED) {
            return externalStatus;
        }

        if (!instance.health) {
            //No health url means we assume it's healthy as soon as it's running
            return InstanceStatus.READY;
        }

        return new Promise((resolve) => {
            if (!instance.health) {
                resolve(InstanceStatus.READY);
                return;
            }
            request(instance.health, (err, response) => {
                if (err) {
                    resolve(InstanceStatus.UNHEALTHY);
                    return;
                }

                if (response.statusCode > 399) {
                    resolve(InstanceStatus.UNHEALTHY);
                    return;
                }

                resolve(InstanceStatus.READY);
            });
        });
    }

    private async isSingletonOperator(blockAsset: EnrichedAsset): Promise<boolean> {
        const provider = await assetManager.getAsset(blockAsset.data.kind);
        if (!provider) {
            return false;
        }

        if (parseKapetaUri(provider.kind).fullName === KIND_BLOCK_TYPE_OPERATOR) {
            const localConfig = provider.data.spec.local as LocalInstance;
            return localConfig.singleton ?? false;
        }

        return false;
    }

    private async getKindForAssetRef(assetRef: string): Promise<string | null> {
        const block = await assetManager.getAsset(assetRef);
        if (!block) {
            return null;
        }

        return block.data.kind;
    }

    /**
     * Get the kind of an asset. Use the maxDepth parameter to specify how deep to look for the
     * kind. For example, if maxDepth is 2, the method will look for the kind of the asset and then
     * the kind of the kind.
     * @param assetRef The asset reference
     * @param maxDepth The maximum depth to look for the kind
     * @returns The kind of the asset or null if not found
     */
    private async getDeepKindForAssetRef(assetRef: string, maxDepth: number): Promise<string | null> {
        if (maxDepth <= 0) {
            return null;
        }

        try {
            const asset = await assetManager.getAsset(assetRef);
            if (!asset || !asset.data.kind) {
                return null;
            }

            if (maxDepth === 1) {
                return asset.data.kind;
            } else {
                // Recurse with the kind of the current block and one less depth
                return await this.getDeepKindForAssetRef(asset.data.kind, maxDepth - 1);
            }
        } catch (error) {
            console.error('Error fetching kind for assetRef:', assetRef, error);
            return null;
        }
    }

    private async isUsingKind(ref: string, kind: string): Promise<boolean> {
        const assetKind = await this.getKindForAssetRef(ref);
        if (!assetKind) {
            return false;
        }

        return parseKapetaUri(assetKind).fullName === parseKapetaUri(kind).fullName;
    }

    private async getAllInstancesForKind(systemId: string, kind: string): Promise<string[]> {
        const plan = await assetManager.getPlan(systemId);
        if (!plan?.spec?.blocks) {
            return [];
        }
        const out: string[] = [];
        for (const block of plan.spec.blocks) {
            if (await this.isUsingKind(block.block.ref, kind)) {
                out.push(block.id);
            }
        }

        return out;
    }

    /**
     * Get the ids for all block instances except the ones of the specified kind
     * @param systemId The plan reference id
     * @param kind The kind to exclude. Can be a string or an array of strings
     * @returns An array of block instance ids
     */
    private async getAllInstancesExceptKind(systemId: string, kind: string | string[]): Promise<string[]> {
        const plan = await assetManager.getPlan(systemId);
        if (!plan?.spec?.blocks) {
            return [];
        }
        const out: string[] = [];
        const excludedKinds = kind instanceof Array ? kind : [kind];
        for (const block of plan.spec.blocks) {
            const blockKindOfKind = await this.getDeepKindForAssetRef(block.block.ref, 2);
            if (!blockKindOfKind) {
                continue;
            }

            const shouldIncludeBlock =
                excludedKinds.some((excludedKind) => excludedKind === parseKapetaUri(blockKindOfKind).fullName) ===
                false;
            if (shouldIncludeBlock) {
                out.push(block.id);
            }
        }

        return out;
    }
}

export const instanceManager = new InstanceManager();
