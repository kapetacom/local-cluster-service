import _ from 'lodash';
import request from 'request';
import EventEmitter from 'events';
import { BlockInstanceRunner } from './utils/BlockInstanceRunner';
import { storageService } from './storageService';
import { socketManager } from './socketManager';
import { serviceManager } from './serviceManager';
import { assetManager } from './assetManager';
import { containerManager } from './containerManager';
import { configManager } from './configManager';
import { InstanceInfo, LogEntry, ProcessInfo } from './types';
import { BlockInstance } from '@kapeta/schemas';

const CHECK_INTERVAL = 10000;
const DEFAULT_HEALTH_PORT_TYPE = 'rest';

const EVENT_STATUS_CHANGED = 'status-changed';
const EVENT_INSTANCE_CREATED = 'instance-created';
const EVENT_INSTANCE_EXITED = 'instance-exited';
const EVENT_INSTANCE_LOG = 'instance-log';

const STATUS_STARTING = 'starting';
const STATUS_READY = 'ready';
const STATUS_UNHEALTHY = 'unhealthy';
const STATUS_STOPPED = 'stopped';

const MIN_TIME_RUNNING = 30000; //If something didnt run for more than 30 secs - it failed

class InstanceManager {
    private _interval: NodeJS.Timer;

    /**
     * Contains an array of running instances that have self-registered with this
     * cluster service. This is done by the Kapeta SDKs
     */
    private _instances: InstanceInfo[] = [];

    /**
     * Contains the process info for the instances started by this manager. In memory only
     * so can't be relied on for knowing everything that's running.
     *
     */
    private _processes: { [systemId: string]: { [instanceId: string]: ProcessInfo } } = {};

    constructor() {
        this._interval = setInterval(() => this._checkInstances(), CHECK_INTERVAL);
        this._instances = storageService.section('instances', []);
        this._processes = {};

        this._checkInstances();
    }

    _save() {
        storageService.put('instances', this._instances);
    }

    async _checkInstances() {
        let changed = false;
        for (let i = 0; i < this._instances.length; i++) {
            const instance = this._instances[i];

            const newStatus = await this._getInstanceStatus(instance);

            if (newStatus === STATUS_UNHEALTHY && instance.status === STATUS_STARTING) {
                // If instance is starting we consider unhealthy an indication
                // that it is still starting
                continue;
            }

            if (instance.status !== newStatus) {
                instance.status = newStatus;
                console.log(
                    'Instance status changed: %s %s -> %s',
                    instance.systemId,
                    instance.instanceId,
                    instance.status
                );
                this._emit(instance.systemId, EVENT_STATUS_CHANGED, instance);
                changed = true;
            }
        }

        if (changed) {
            this._save();
        }
    }

    async _isRunning(instance: InstanceInfo) {
        if (!instance.pid) {
            return;
        }

        if (instance.type === 'docker') {
            const container = await containerManager.get(instance.pid as string);
            if (!container) {
                console.warn('Container not found: %s', instance.pid);
                return false;
            }
            return await container.isRunning();
        }

        //Otherwise its just a normal process.
        //TODO: Handle for Windows
        try {
            return process.kill(instance.pid as number, 0);
        } catch (err: any) {
            return err.code === 'EPERM';
        }
    }

    async _getInstanceStatus(instance: InstanceInfo): Promise<string> {
        if (instance.status === STATUS_STOPPED) {
            //Will only change when it reregisters
            return STATUS_STOPPED;
        }

        if (!(await this._isRunning(instance))) {
            return STATUS_STOPPED;
        }

        if (!instance.health) {
            //No health url means we assume it's healthy as soon as it's running
            return STATUS_READY;
        }

        return new Promise((resolve) => {
            if (!instance.health) {
                resolve(STATUS_READY);
                return;
            }
            request(instance.health, (err, response) => {
                if (err) {
                    resolve(STATUS_UNHEALTHY);
                    return;
                }

                if (response.statusCode > 399) {
                    resolve(STATUS_UNHEALTHY);
                    return;
                }

                resolve(STATUS_READY);
            });
        });
    }

    getInstances() {
        if (!this._instances) {
            return [];
        }

        return [...this._instances];
    }

    getInstancesForPlan(systemId: string) {
        if (!this._instances) {
            return [];
        }

        return this._instances.filter((instance) => instance.systemId === systemId);
    }

    /**
     * Get instance information
     *
     * @param {string} systemId
     * @param {string} instanceId
     * @return {*}
     */
    getInstance(systemId: string, instanceId: string) {
        return _.find(this._instances, { systemId, instanceId });
    }

    /**
     *
     * @param {string} systemId
     * @param {string} instanceId
     * @param {InstanceInfo} info
     * @return {Promise<void>}
     */
    async registerInstance(systemId: string, instanceId: string, info: Omit<InstanceInfo, 'systemId' | 'instanceId'>) {
        let instance = this.getInstance(systemId, instanceId);

        //Get target address
        let address = await serviceManager.getProviderAddress(
            systemId,
            instanceId,
            info.portType ?? DEFAULT_HEALTH_PORT_TYPE
        );

        let healthUrl = null;
        let health = info.health;
        if (health) {
            if (health.startsWith('/')) {
                health = health.substring(1);
            }
            healthUrl = address + health;
        }

        if (instance) {
            instance.status = STATUS_STARTING;
            instance.pid = info.pid;
            instance.address = address;
            if (info.type) {
                instance.type = info.type;
            }
            if (healthUrl) {
                instance.health = healthUrl;
            }
            this._emit(systemId, EVENT_STATUS_CHANGED, instance);
        } else {
            instance = {
                systemId,
                instanceId,
                status: STATUS_STARTING,
                pid: info.pid,
                type: info.type,
                health: healthUrl,
                address,
            };

            this._instances.push(instance);

            this._emit(systemId, EVENT_INSTANCE_CREATED, instance);
        }

        this._save();
    }

    setInstanceAsStopped(systemId: string, instanceId: string) {
        const instance = _.find(this._instances, { systemId, instanceId });
        if (instance) {
            instance.status = STATUS_STOPPED;
            instance.pid = null;
            instance.health = null;
            this._emit(systemId, EVENT_STATUS_CHANGED, instance);
            this._save();
        }
    }

    _emit(systemId: string, type: string, payload: any) {
        try {
            socketManager.emit(`${systemId}/instances`, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    async createProcessesForPlan(planRef: string): Promise<ProcessInfo[]> {
        await this.stopAllForPlan(planRef);

        const plan = await assetManager.getPlan(planRef, true);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        if (!plan.spec.blocks) {
            console.warn('No blocks found in plan', planRef);
            return [];
        }

        let promises: Promise<ProcessInfo>[] = [];
        let errors = [];
        for (let blockInstance of Object.values(plan.spec.blocks as BlockInstance[])) {
            try {
                promises.push(this.createProcess(planRef, blockInstance.id));
            } catch (e) {
                errors.push(e);
            }
        }

        const settled = await Promise.allSettled(promises);

        if (errors.length > 0) {
            throw errors[0];
        }

        return settled.map((p) => (p.status === 'fulfilled' ? p.value : null)).filter((p) => !!p) as ProcessInfo[];
    }

    async _stopInstance(instance: InstanceInfo) {
        if (!instance.pid) {
            return;
        }

        if (instance.status === 'stopped') {
            return;
        }

        try {
            if (instance.type === 'docker') {
                const container = await containerManager.get(instance.pid as string);
                if (container) {
                    try {
                        await container.stop();
                    } catch (e) {
                        console.error('Failed to stop container', e);
                    }
                }
                return;
            }
            process.kill(instance.pid as number, 'SIGTERM');
        } catch (e) {
            console.error('Failed to stop process', e);
        }
    }

    async stopAllForPlan(planRef: string) {
        if (this._processes[planRef]) {
            const promises = [];
            console.log('Stopping all processes for plan', planRef);
            for (let instance of Object.values(this._processes[planRef])) {
                promises.push(instance.stop());
            }

            await Promise.all(promises);

            this._processes[planRef] = {};
        }

        //Also stop instances not being maintained by the cluster service
        const instancesForPlan = this._instances.filter((instance) => instance.systemId === planRef);

        const promises = [];
        for (let instance of instancesForPlan) {
            promises.push(this._stopInstance(instance));
        }

        await Promise.all(promises);
    }

    async createProcess(planRef: string, instanceId: string): Promise<ProcessInfo> {
        const plan = await assetManager.getPlan(planRef, true);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        const blockInstance = plan.spec && plan.spec.blocks ? _.find(plan.spec.blocks, { id: instanceId }) : null;
        if (!blockInstance) {
            throw new Error('Block instance not found: ' + instanceId);
        }

        const blockRef = blockInstance.block.ref;

        const blockAsset = await assetManager.getAsset(blockRef, true);
        const instanceConfig = await configManager.getConfigForSection(planRef, instanceId);

        if (!blockAsset) {
            throw new Error('Block not found: ' + blockRef);
        }

        if (!this._processes[planRef]) {
            this._processes[planRef] = {};
        }

        await this.stopProcess(planRef, instanceId);
        const type = blockAsset.version === 'local' ? 'local' : 'docker';

        const runner = new BlockInstanceRunner(planRef);

        const startTime = Date.now();
        try {
            const process = await runner.start(blockRef, instanceId, instanceConfig);
            //emit stdout/stderr via sockets
            process.output.on('data', (data: Buffer) => {
                const payload = {
                    source: 'stdout',
                    level: 'INFO',
                    message: data.toString(),
                    time: Date.now(),
                };
                this._emit(instanceId, EVENT_INSTANCE_LOG, payload);
            });

            process.output.on('exit', (exitCode: number) => {
                const timeRunning = Date.now() - startTime;
                const instance = this.getInstance(planRef, instanceId);
                if (instance?.status === STATUS_READY) {
                    //It's already been running
                    return;
                }

                if (exitCode === 143 || exitCode === 137) {
                    //Process got SIGTERM (143) or SIGKILL (137)
                    //TODO: Windows?
                    return;
                }

                if (exitCode !== 0 || timeRunning < MIN_TIME_RUNNING) {
                    this._emit(blockInstance.id, EVENT_INSTANCE_EXITED, {
                        error: 'Failed to start instance',
                        status: EVENT_INSTANCE_EXITED,
                        instanceId: blockInstance.id,
                    });
                }
            });

            await this.registerInstance(planRef, instanceId, {
                type: process.type,
                pid: process.pid ?? -1,
                health: null,
                portType: process.portType,
                status: STATUS_STARTING,
            });

            return (this._processes[planRef][instanceId] = process);
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

            await this.registerInstance(planRef, instanceId, {
                type: 'local',
                pid: null,
                health: null,
                portType: DEFAULT_HEALTH_PORT_TYPE,
                status: STATUS_UNHEALTHY,
            });

            this._emit(instanceId, EVENT_INSTANCE_LOG, logs[0]);

            this._emit(blockInstance.id, EVENT_INSTANCE_EXITED, {
                error: `Failed to start instance: ${e.message}`,
                status: EVENT_INSTANCE_EXITED,
                instanceId: blockInstance.id,
            });

            return (this._processes[planRef][instanceId] = {
                pid: -1,
                type,
                logs: () => logs,
                stop: () => Promise.resolve(),
                ref: blockRef,
                id: instanceId,
                name: blockInstance.name,
                output: new EventEmitter(),
            });
        }
    }

    /**
     *
     * @param {string} planRef
     * @param {string} instanceId
     * @return {ProcessInfo|null}
     */
    getProcessForInstance(planRef: string, instanceId: string) {
        if (!this._processes[planRef]) {
            return null;
        }

        return this._processes[planRef][instanceId];
    }

    async restartIfRunning(planRef: string, instanceId: string) {
        if (!this._processes[planRef] || !this._processes[planRef][instanceId]) {
            return;
        }

        // createProcess will stop the process first if it's running
        return this.createProcess(planRef, instanceId);
    }

    async stopProcess(planRef: string, instanceId: string) {
        if (!this._processes[planRef]) {
            return;
        }

        if (this._processes[planRef][instanceId]) {
            try {
                await this._processes[planRef][instanceId].stop();
            } catch (e) {
                console.error('Failed to stop process for instance: %s -> %s', planRef, instanceId, e);
            }
            delete this._processes[planRef][instanceId];
        }
    }

    async stopAllProcesses() {
        for (let processesForPlan of Object.values(this._processes)) {
            for (let processInfo of Object.values(processesForPlan)) {
                await processInfo.stop();
            }
        }
        this._processes = {};

        for (let instance of this._instances) {
            await this._stopInstance(instance);
        }
    }
}

export const instanceManager = new InstanceManager();

process.on('exit', async () => {
    await instanceManager.stopAllProcesses();
});