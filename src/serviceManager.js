const clusterService = require('./clusterService');
const storageService = require('./storageService');
const _ = require('lodash');

const DEFAULT_PORT_TYPE = 'rest';

class ServiceManager {

    constructor() {
        this._services = storageService.get("services");
        if (!this._services) {
            this._services = {};
        }

        _.forEach(this._services, (service) => {
            _.forEach(service, (portInfo, portType) => {
                clusterService.reservePort(portInfo.port);
            });

        });
    }

    _forLocal(port, path) {
        if (!path) {
            path = '';
        }

        if (path.startsWith('/')) {
            path = path.substr(1);
        }
        return `http://localhost:${port}/${path}`;
    }

    async ensureServicePort(serviceId, portType) {
        if (!portType) {
            portType = DEFAULT_PORT_TYPE;
        }

        if (!this._services[serviceId]) {
            this._services[serviceId] = {};
        }

        if (!this._services[serviceId][portType]) {
            const port = await clusterService.getNextAvailablePort();
            this._services[serviceId][portType] = {port};
            this._save();
        }

        const portTypeSection = this._services[serviceId][portType];


        return portTypeSection.port;
    }

    _save() {
        storageService.put("services", this._services);
    }

    /**
     * Gets the address of a service (toServiceId + portType) as seen from "fromServiceId".
     *
     * This returns a local proxy path to allow traffic inspection and control.
     *
     * @param fromServiceId
     * @param toServiceId
     * @param portType
     * @return {string}
     */
    getConsumerAddress(fromServiceId, toServiceId, portType) {
        const port = clusterService.getClusterServicePort();
        const path = clusterService.getProxyPath(fromServiceId, toServiceId, portType);
        return this._forLocal(port, path);
    }

    /**
     * Gets the address of a service seen from the local-service cluster.
     *
     * This returns the actual endpoint address of a service that we're talking to.
     * For local services this address will be on localhost - for remote services it will
     * be their remotely available address.
     *
     * @param serviceId
     * @param portType
     * @return {string}
     */
    async getProviderAddress(serviceId, portType) {
        const port = await this.ensureServicePort(serviceId, portType);
        return this._forLocal(port)
    }

    getServices() {
        return this._services;
    }

    getProvidersFor(serviceId) {
        if (!this._services[serviceId]) {
            this._services[serviceId] = {};
        }

        return _.cloneDeep(this._services[serviceId]);
    }

    getConsumersFor(fromServiceId) {
        const consumers = {};
        _.forEach(this._services, (portTypes, toServiceId) => {
            if (fromServiceId === toServiceId) {
                return; //Ignore itself
            }

            if (!consumers[toServiceId]) {
                consumers[toServiceId] = {};
            }

            _.forEach(portTypes, (portTypeInfo, portType) => {
                consumers[toServiceId][portType] = this.getConsumerAddress(fromServiceId, toServiceId, portType);
            });
        });
        return consumers;
    }
}

module.exports = new ServiceManager();