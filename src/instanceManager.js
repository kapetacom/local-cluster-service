const _ = require('lodash');
const request = require('request');

const {BlockInstanceRunner} = require('@blockware/local-cluster-executor');

const storageService = require('./storageService');
const socketManager = require('./socketManager');
const serviceManager = require('./serviceManager');
const assetManager = require('./assetManager');
const containerManager = require('./containerManager');
const {parseBlockwareUri} = require("@blockware/local-cluster-executor/src/utils");

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
    constructor() {
        this._interval = setInterval(() => this._checkInstances(), CHECK_INTERVAL);
        /**
         * Contains an array of running instances that have self-registered with this
         * cluster service. This is done by the Blockware SDKs
         *
         * @type {any[]}
         * @private
         */
        this._instances = storageService.section('instances', []);
        /**
         * Contains the process info for the instances started by this manager. In memory only
         * so can't be relied on for knowing everything that's running.
         *
         * @type {{[systemId:string]:{[instanceId:string]:ProcessInfo}}}
         * @private
         */
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

            if (newStatus === STATUS_UNHEALTHY &&
                instance.status === STATUS_STARTING) {
                // If instance is starting we consider unhealthy an indication
                // that it is still starting
                continue;
            }

            if (instance.status !== newStatus) {
                instance.status = newStatus;
                this._emit(instance.systemId, EVENT_STATUS_CHANGED, instance);
                changed = true;
            }
        }

        if (changed) {
            this._save();
        }
    }

    async _isRunning(instance) {
        if (!instance.pid) {
            return;
        }

        if (instance.type === 'docker') {
            const container = await containerManager.get(instance.pid);
            return await container.isRunning()
        }

        //Otherwise its just a normal process.
        //TODO: Handle for Windows
        try {
            return process.kill(instance.pid, 0)
        } catch (err) {
            return err.code === 'EPERM';
        }
    }

    async _getInstanceStatus(instance) {
        if (instance.status === STATUS_STOPPED) {
            //Will only change when it reregisters
            return STATUS_STOPPED;
        }

        if (!await this._isRunning(instance)) {
            return STATUS_STOPPED;
        }

        if (!instance.health) {
            //No health url means we assume it's healthy as soon as it's running
            return STATUS_READY;
        }

        return new Promise((resolve) => {
            request(instance.health, (err, response) => {
                if (err) {
                    resolve(STATUS_UNHEALTHY);
                    return;
                }

                if (response.responseCode > 399) {
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

    getInstancesForPlan(systemId) {
        if (!this._instances) {
            return [];
        }

        return this._instances.filter(instance => instance.systemId === systemId);
    }

    /**
     *
     * @param {string} systemId
     * @param {string} instanceId
     * @param {{health:string,pid:string,type:'docker'|'local',portType?:string}} info
     * @return {Promise<void>}
     */
    async registerInstance(systemId, instanceId, info) {
        let instance = _.find(this._instances, {systemId, instanceId});

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
            instance.type = info.type;
            instance.health = healthUrl;
            this._emit(systemId, EVENT_STATUS_CHANGED, instance);
        } else {
            instance = {
                systemId,
                instanceId,
                status: STATUS_STARTING,
                pid: info.pid,
                type: info.type,
                health: healthUrl
            };

            this._instances.push(instance);

            this._emit(systemId, EVENT_INSTANCE_CREATED, instance);
        }

        this._save();
    }

    setInstanceAsStopped(systemId, instanceId) {
        const instance = _.find(this._instances, {systemId, instanceId});
        if (instance) {
            instance.status = STATUS_STOPPED;
            instance.pid = null;
            instance.health = null;
            this._emit(systemId, EVENT_STATUS_CHANGED, instance);
            this._save();
        }
    }

    _emit(systemId, type, payload) {
        socketManager.emit(`${systemId}/instances`, type, payload);
    }

    /**
     *
     * @param planRef
     * @return {Promise<ProcessInfo[]>}
     */
    async createProcessesForPlan(planRef) {
        await this.stopAllForPlan(planRef);

        const plan = assetManager.getPlan(planRef);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        if (!plan.spec.blocks) {
            console.warn('No blocks found in plan', planRef);
            return [];
        }

        let processes = [];
        let errors = [];
        for(let blockInstance of Object.values(plan.spec.blocks)) {
            try {
                processes.push(await this.createProcess(planRef, blockInstance.id));
            } catch (e) {
                errors.push(e);
            }
        }

        if (errors.length > 0) {
            throw errors[0];
        }

        return processes;
    }

    async _stopInstance(instance) {
        if (!instance.pid) {
            return;
        }

        if (instance.status === 'stopped') {
            return;
        }

        try {
            if (instance.type === 'docker') {
                const container = await containerManager.get(instance.pid);
                await container.stop();
                return;
            }
            //TODO: Handle for windows
            process.kill(instance.pid, 'SIGKILL');
        } catch (e) {
            console.error('Failed to stop process', e);
        }
    }

    async stopAllForPlan(planRef) {
        if (this._processes[planRef]) {
            for(let instance of Object.values(this._processes[planRef])) {
                await instance.stop();
            }

            this._processes[planRef] = {};
        }

        //Also stop instances not being maintained by the cluster service
        const instancesForPlan = this._instances
            .filter(instance => instance.systemId === planRef);

        for(let instance of instancesForPlan) {
            await this._stopInstance(instance);
        }
    }

    /**
     *
     * @param planRef
     * @param instanceId
     * @return {Promise<PromiseInfo>}
     */
    async createProcess(planRef, instanceId) {
        const plan = assetManager.getPlan(planRef);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        const blockInstance = plan.spec && plan.spec.blocks ? _.find(plan.spec.blocks, {id: instanceId}) : null;
        if (!blockInstance) {
            throw new Error('Block instance not found: ' + instanceId);
        }

        const blockRef = blockInstance.block.ref;

        const blockAsset = assetManager.getAsset(blockRef);

        if (!blockAsset) {
            throw new Error('Block not found: ' + blockRef);
        }

        if (!this._processes[planRef]) {
            this._processes[planRef] = {};
        }

        await this.stopProcess(planRef, instanceId);

        const runner = new BlockInstanceRunner(planRef);
        const startTime = Date.now();
        const process = await runner.start(blockRef, instanceId);
        //emit stdout/stderr via sockets
        process.output.on("data", (data) => {
            const payload = {source: "stdout", level: "INFO", message: data.toString(), time: Date.now()};
            this._emit(instanceId, EVENT_INSTANCE_LOG, payload);
        });

        process.output.on('exit', (exitCode) => {
            const timeRunning = Date.now() - startTime;
            if (exitCode !== 0 || timeRunning < MIN_TIME_RUNNING) {
                this._emit(blockInstance.id, EVENT_INSTANCE_EXITED, {
                    error: "Failed to start instance",
                    status: EVENT_INSTANCE_EXITED,
                    instanceId: blockInstance.id
                })
            }
        });

        await this.registerInstance(planRef, instanceId, {
            type: process.type,
            pid: process.pid,
            health: null
        });

        return this._processes[planRef][instanceId] = process;
    }

    /**
     *
     * @param {string} planRef
     * @param {string} instanceId
     * @return {ProcessInfo|null}
     */
    getProcessForInstance(planRef, instanceId) {
        if (!this._processes[planRef]) {
            return null;
        }

        return this._processes[planRef][instanceId];
    }

    async stopProcess(planRef, instanceId) {
        if (!this._processes[planRef]) {
            return;
        }

        if (this._processes[planRef][instanceId]) {
            await this._processes[planRef][instanceId].stop();
            delete this._processes[planRef][instanceId];
        }
    }

    async stopAllProcesses() {
        for(let processesForPlan of Object.values(this._processes)) {
            for(let processInfo of Object.values(processesForPlan)) {
                await processInfo.stop();
            }
        }
        this._processes = {};

        for(let instance of this._instances) {
            await this._stopInstance(instance);
        }
    }
}


const instanceManager = new InstanceManager();

process.on('exit', async () => {
    await instanceManager.stopAllProcesses();
});

module.exports = instanceManager;