const _ = require('lodash');
const request = require('request');
const Path = require('path');

const { BlockInstanceRunner } = require('@blockware/local-cluster-executor');

const storageService = require('./storageService');
const socketManager = require('./socketManager');
const serviceManager = require('./serviceManager');
const assetManager = require('./assetManager');

const CHECK_INTERVAL = 10000;
const HEALTH_PORT_TYPE = 'rest';

const EVENT_STATUS_CHANGED = 'status-changed';
const EVENT_INSTANCE_CREATED = 'instance-created';
const EVENT_INSTANCE_EXITED = 'instance-exited';

const STATUS_STARTING = 'starting';
const STATUS_READY = 'ready';
const STATUS_UNHEALTHY = 'unhealthy';
const STATUS_STOPPED = 'stopped';

function isPidRunning(pid) {
    try {
        return process.kill(pid,0)
    } catch (err) {
        return err.code === 'EPERM';
    }
}

class InstanceManager {
    constructor() {
        this._instances = storageService.section('instances', []);
        this._interval = setInterval(() => this._checkInstances(), CHECK_INTERVAL);
        this._processes = {};

        this._checkInstances();
    }

    _save(){
        storageService.put('instances', this._instances);
    }

    async _checkInstances() {
        let changed = false;
        for(let i = 0; i < this._instances.length; i++) {
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

    async _getInstanceStatus(instance) {
        if (instance.status === STATUS_STOPPED) {
            //Will only change when it reregisters
            return STATUS_STOPPED;
        }

        if (!instance.pid ||
            !isPidRunning(instance.pid)) {
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

        return _.clone(this._instances);
    }

    async registerInstance(systemId, instanceId, info) {
        let instance = _.find(this._instances, {systemId, instanceId});

        //Get target address
        let address = await serviceManager.getProviderAddress(
            systemId,
            instanceId,
            HEALTH_PORT_TYPE
        );

        let healthUrl = null;
        let health = info.health;
        if (health) {
            if (health.startsWith('/')) {
                health = health.substr(1);
            }
            healthUrl = address + health;
        }

        if (instance) {
            instance.status = STATUS_STARTING;
            instance.pid = info.pid;
            instance.health = healthUrl;
            this._emit(systemId, EVENT_STATUS_CHANGED, instance);
        } else {
            instance = {
                systemId,
                instanceId,
                status: STATUS_STARTING,
                pid: info.pid,
                health: healthUrl
            };

            this._instances.push(instance);

            this._emit(systemId, EVENT_INSTANCE_CREATED, instance);
        }

        this._save();
    }

    instanceStopped(systemId, instanceId) {
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

    startAllInstances(planRef) {
        this.stopAllInstances(planRef);

        const plan = assetManager.getPlan(planRef);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        if (!plan.spec.blocks) {
            console.warn('No blocks found in plan', planRef);
            return;
        }

        _.forEach(plan.spec.blocks, (blockInstance) => {
            this.startInstance(planRef, blockInstance.id);
        })
    }

    stopAllInstances(planRef) {
        if (this._processes[planRef]) {
            _.forEach(this._processes[planRef], (instance) => {
                instance.process.kill();
            });

            this._processes[planRef] = {};
        }

        //Also stop instances not being maintained by the cluster service
        this._instances
            .filter(instance => instance.systemId === planRef)
            .forEach((instance) => {
                if (instance.pid) {
                    try {
                        process.kill(instance.pid);
                    } catch(err) {
                        console.log('Failed to kill process: %s', instance.pid);
                    }
                }
            });
    }

    startInstance(planRef, instanceId) {
        const plan = assetManager.getPlan(planRef);
        if (!plan) {
            throw new Error('Plan not found: ' + planRef);
        }

        const blockInstance = plan.spec && plan.spec.blocks ? _.find(plan.spec.blocks, {id: instanceId}) : null;
        if (!blockInstance) {
            throw new Error('Block instance not found: ' + instanceId);
        }

        const blockAsset = assetManager.getAsset(blockInstance.block.ref);

        if (!blockAsset) {
            throw new Error('Block not found: ' + blockInstance.block.ref);
        }

        if (!this._processes[planRef]) {
            this._processes[planRef] = {};
        }

        this.stopInstance(planRef, instanceId);

        const process = BlockInstanceRunner.start(Path.dirname(blockAsset.path), blockInstance.block.ref, planRef, instanceId);
        if (!process) {
            throw new Error('Start script not available for block: ' + blockInstance.block.ref);
        }
        process.process.on('exit', (message) => {            
            if (message === 0) {
                this._emit(blockInstance.id, EVENT_INSTANCE_EXITED, { error: "failed to start instance", status: EVENT_INSTANCE_EXITED, instanceId: blockInstance.id })
            }
        })

        this._processes[planRef][instanceId] = process;
    }

    stopInstance(planRef, instanceId) {
        if (!this._processes[planRef]) {
            return;
        }

        if (this._processes[planRef][instanceId]) {
            this._processes[planRef][instanceId].process.kill();
            delete this._processes[planRef][instanceId];
        }
    }

    stopAll() {
        _.forEach(this._processes, (instances) => {
            _.forEach(instances, (instance) => {
                instance.process.kill();
            });
        });

        this._processes = {};
    }
}


const instanceManager = new InstanceManager();

process.on('exit', () => {
    instanceManager.stopAll();
});

module.exports = instanceManager;