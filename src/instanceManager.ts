import _ from 'lodash';
import request from 'request';
import { BlockInstanceRunner } from './utils/BlockInstanceRunner';
import { storageService } from './storageService';
import { socketManager } from './socketManager';
import { serviceManager } from './serviceManager';
import { assetManager } from './assetManager';
import { containerManager, HEALTH_CHECK_TIMEOUT } from './containerManager';
import { configManager } from './configManager';
import { DesiredInstanceStatus, InstanceInfo, InstanceOwner, InstanceStatus, InstanceType, LogEntry } from './types';
import { BlockInstance } from '@kapeta/schemas';
import { getBlockInstanceContainerName, normalizeKapetaUri } from './utils/utils';

const CHECK_INTERVAL = 5000;
const DEFAULT_HEALTH_PORT_TYPE = 'rest';

const EVENT_STATUS_CHANGED = 'status-changed';
const EVENT_INSTANCE_CREATED = 'instance-created';
const EVENT_INSTANCE_EXITED = 'instance-exited';
const EVENT_INSTANCE_LOG = 'instance-log';
const MIN_TIME_RUNNING = 30000; //If something didnt run for more than 30 secs - it failed

export class InstanceManager {
    private _interval: NodeJS.Timer | undefined = undefined;

    private readonly _instances: InstanceInfo[] = [];

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

    public getInstancesForPlan(systemId: string) {
        if (!this._instances) {
            return [];
        }

        systemId = normalizeKapetaUri(systemId);

        return this._instances.filter((instance) => instance.systemId === systemId);
    }

    public getInstance(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);

        return this._instances.find((i) => i.systemId === systemId && i.instanceId === instanceId);
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
            this.emitSystemEvent(instance.systemId, EVENT_STATUS_CHANGED, instance);
        } else {
            this._instances.push(instance);
            this.emitSystemEvent(instance.systemId, EVENT_INSTANCE_CREATED, instance);
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
            if (instance.status === InstanceStatus.STOPPING && instance.desiredStatus === DesiredInstanceStatus.STOP) {
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
                instance.internal = undefined;
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

            this.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
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

            this.emitSystemEvent(systemId, EVENT_INSTANCE_CREATED, instance);
        }

        this.save();

        return instance;
    }

    private getHealthUrl(info: Omit<InstanceInfo, 'systemId' | 'instanceId'>, address: string) {
        let healthUrl = null;
        let health = info.health;
        if (health) {
            if (health.startsWith('/')) {
                health = health.substring(1);
            }
            healthUrl = address + health;
        }
        return healthUrl;
    }

    public markAsStopped(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);
        const instance = _.find(this._instances, { systemId, instanceId });
        if (instance && instance.owner === InstanceOwner.EXTERNAL && instance.status !== InstanceStatus.STOPPED) {
            instance.status = InstanceStatus.STOPPED;
            instance.pid = null;
            instance.health = null;
            this.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
            this.save();
        }
    }

    public async startAllForPlan(systemId: string): Promise<InstanceInfo[]> {
        systemId = normalizeKapetaUri(systemId);
        const plan = await assetManager.getPlan(systemId, true);
        if (!plan) {
            throw new Error('Plan not found: ' + systemId);
        }

        if (!plan.spec.blocks) {
            console.warn('No blocks found in plan', systemId);
            return [];
        }

        let promises: Promise<InstanceInfo>[] = [];
        let errors = [];
        for (let blockInstance of Object.values(plan.spec.blocks as BlockInstance[])) {
            try {
                promises.push(this.start(systemId, blockInstance.id));
            } catch (e) {
                errors.push(e);
            }
        }

        const settled = await Promise.allSettled(promises);

        if (errors.length > 0) {
            throw errors[0];
        }

        return settled.map((p) => (p.status === 'fulfilled' ? p.value : null)).filter((p) => !!p) as InstanceInfo[];
    }

    public async stop(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);
        const instance = this.getInstance(systemId, instanceId);
        if (!instance) {
            return;
        }

        if (instance.status === InstanceStatus.STOPPED) {
            return;
        }

        if (instance.desiredStatus !== DesiredInstanceStatus.EXTERNAL) {
            instance.desiredStatus = DesiredInstanceStatus.STOP;
        }

        instance.status = InstanceStatus.STOPPING;

        this.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
        console.log('Stopping instance: %s::%s [desired: %s]', systemId, instanceId, instance.desiredStatus);
        this.save();

        try {
            if (instance.type === 'docker') {
                const containerName = getBlockInstanceContainerName(instance.instanceId);
                const container = await containerManager.getContainerByName(containerName);
                if (container) {
                    try {
                        await container.stop();
                        instance.status = InstanceStatus.STOPPED;
                        this.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
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
            this.emitSystemEvent(systemId, EVENT_STATUS_CHANGED, instance);
            this.save();
        } catch (e) {
            console.error('Failed to stop process', e);
        }
    }

    public async stopAllForPlan(systemId: string) {
        systemId = normalizeKapetaUri(systemId);
        const instancesForPlan = this._instances.filter((instance) => instance.systemId === systemId);

        return this.stopInstances(instancesForPlan);
    }

    public async start(systemId: string, instanceId: string): Promise<InstanceInfo> {
        systemId = normalizeKapetaUri(systemId);
        const plan = await assetManager.getPlan(systemId, true);
        if (!plan) {
            throw new Error('Plan not found: ' + systemId);
        }

        const blockInstance = plan.spec && plan.spec.blocks ? _.find(plan.spec.blocks, { id: instanceId }) : null;
        if (!blockInstance) {
            throw new Error('Block instance not found: ' + instanceId);
        }

        const blockRef = normalizeKapetaUri(blockInstance.block.ref);

        const blockAsset = await assetManager.getAsset(blockRef, true);
        if (!blockAsset) {
            throw new Error('Block not found: ' + blockRef);
        }

        const existingInstance = this.getInstance(systemId, instanceId);

        if (existingInstance) {
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
            type: InstanceType.UNKNOWN,
            status: InstanceStatus.STARTING,
            startedAt: Date.now(),
        };

        console.log('Starting instance: %s::%s [desired: %s]', systemId, instanceId, instance.desiredStatus);
        // Save the instance before starting it, so that we can track the status
        await this.saveInternalInstance(instance);

        if (existingInstance) {
            // Check if the instance is already running - but after we've commmuicated the desired status
            const currentStatus = await this.requestInstanceStatus(existingInstance);
            if (currentStatus === InstanceStatus.READY) {
                // Instance is already running
                return existingInstance;
            }
        }

        const instanceConfig = await configManager.getConfigForSection(systemId, instanceId);
        const runner = new BlockInstanceRunner(systemId);

        const startTime = Date.now();
        try {
            const processInfo = await runner.start(blockRef, instanceId, instanceConfig);
            //emit stdout/stderr via sockets
            processInfo.output.on('data', (data: Buffer) => {
                const payload = {
                    source: 'stdout',
                    level: 'INFO',
                    message: data.toString(),
                    time: Date.now(),
                };
                this.emitInstanceEvent(systemId, instanceId, EVENT_INSTANCE_LOG, payload);
            });

            processInfo.output.on('exit', (exitCode: number) => {
                const timeRunning = Date.now() - startTime;
                const instance = this.getInstance(systemId, instanceId);
                if (instance?.status === InstanceStatus.READY) {
                    //It's already been running
                    return;
                }

                if (exitCode === 143 || exitCode === 137) {
                    //Process got SIGTERM (143) or SIGKILL (137)
                    //TODO: Windows?
                    return;
                }

                if (exitCode !== 0 || timeRunning < MIN_TIME_RUNNING) {
                    const instance = this.getInstance(systemId, instanceId);
                    if (instance) {
                        instance.status = InstanceStatus.FAILED;
                        this.save();
                    }

                    this.emitSystemEvent(systemId, EVENT_INSTANCE_EXITED, {
                        error: 'Failed to start instance',
                        status: EVENT_INSTANCE_EXITED,
                        instanceId: blockInstance.id,
                    });
                }
            });

            instance.status = InstanceStatus.READY;

            return this.saveInternalInstance({
                ...instance,
                type: processInfo.type,
                pid: processInfo.pid ?? -1,
                health: null,
                portType: processInfo.portType,
                status: InstanceStatus.READY,
                internal: {
                    logs: processInfo.logs,
                    output: processInfo.output,
                },
            });
        } catch (e: any) {
            console.warn('Failed to start instance', e);
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
                type: InstanceType.LOCAL,
                pid: null,
                health: null,
                portType: DEFAULT_HEALTH_PORT_TYPE,
                status: InstanceStatus.FAILED,
            });

            this.emitInstanceEvent(systemId, instanceId, EVENT_INSTANCE_LOG, logs[0]);

            this.emitInstanceEvent(systemId, blockInstance.id, EVENT_INSTANCE_EXITED, {
                error: `Failed to start instance: ${e.message}`,
                status: EVENT_INSTANCE_EXITED,
                instanceId: blockInstance.id,
            });

            return out;
        }
    }

    public async restart(systemId: string, instanceId: string) {
        systemId = normalizeKapetaUri(systemId);
        await this.stop(systemId, instanceId);

        return this.start(systemId, instanceId);
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
                    const copy = { ...instance };
                    delete copy.internal;
                    return copy;
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
            const chunk = all.splice(0, 20);
            const promises = chunk.map(async (instance) => {
                if (!instance.systemId) {
                    return;
                }

                instance.systemId = normalizeKapetaUri(instance.systemId);
                if (instance.ref) {
                    instance.ref = normalizeKapetaUri(instance.ref);
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
                        (newStatus === InstanceStatus.STOPPED && instance.status === InstanceStatus.FAILED) ||
                        ([InstanceStatus.READY, InstanceStatus.UNHEALTHY].includes(newStatus) &&
                            instance.status === InstanceStatus.STOPPING &&
                            instance.desiredStatus === DesiredInstanceStatus.STOP) ||
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
                        this.emitSystemEvent(instance.systemId, EVENT_STATUS_CHANGED, instance);
                        changed = true;
                    }
                }

                if (instance.desiredStatus === DesiredInstanceStatus.RUN && newStatus === InstanceStatus.STOPPED) {
                    //If the instance is stopped but we want it to run, start it
                    try {
                        await this.start(instance.systemId, instance.instanceId);
                    } catch (e: any) {
                        console.warn('Failed to start instance', instance.systemId, instance.instanceId, e);
                    }
                    return;
                }

                if (instance.desiredStatus === DesiredInstanceStatus.STOP && newStatus === InstanceStatus.READY) {
                    //If the instance is running but we want it to stop, stop it
                    try {
                        await this.stop(instance.systemId, instance.instanceId);
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
                        await this.restart(instance.systemId, instance.instanceId);
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
            const containerName = getBlockInstanceContainerName(instance.instanceId);
            const container = await containerManager.getContainerByName(containerName);
            if (!container) {
                // If the container doesn't exist, we consider the instance stopped
                return InstanceStatus.STOPPED;
            }
            const state = await container.status();

            if (state.Status === 'running') {
                if (state.Health?.Status === 'healthy') {
                    return InstanceStatus.READY;
                }
                if (state.Health?.Status === 'starting') {
                    return InstanceStatus.STARTING;
                }
                if (state.Health?.Status === 'unhealthy') {
                    return InstanceStatus.UNHEALTHY;
                }

                return InstanceStatus.READY;
            }
            if (state.Status === 'created') {
                return InstanceStatus.STARTING;
            }

            if (state.Status === 'exited' || state.Status === 'dead') {
                return InstanceStatus.STOPPED;
            }

            if (state.Status === 'removing') {
                return InstanceStatus.BUSY;
            }

            if (state.Status === 'restarting') {
                return InstanceStatus.BUSY;
            }

            if (state.Status === 'paused') {
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

    private emitSystemEvent(systemId: string, type: string, payload: any) {
        systemId = normalizeKapetaUri(systemId);
        try {
            socketManager.emit(`${systemId}/instances`, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    private emitInstanceEvent(systemId: string, instanceId: string, type: string, payload: any) {
        systemId = normalizeKapetaUri(systemId);
        try {
            socketManager.emit(`${systemId}/instances/${instanceId}`, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }
}

export const instanceManager = new InstanceManager();

process.on('exit', async () => {
    await instanceManager.stopAll();
});
