const _ = require('lodash');
const request = require('request');
const storageService = require('./storageService');
const socketManager = require('./socketManager');
const serviceManager = require('./serviceManager');

const CHECK_INTERVAL = 10000;
const HEALTH_PORT_TYPE = 'rest';

const EVENT_STATUS_CHANGED = 'status-changed';
const EVENT_INSTANCE_CREATED = 'instance-created';

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

        this._checkInstances();
    }

    _save() {
        storageService.put('instances', this._instances);
    }

    async _checkInstances() {
        let changed = false;
        for( let i = 0; i < this._instances.length; i++) {
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

}

module.exports = new InstanceManager();