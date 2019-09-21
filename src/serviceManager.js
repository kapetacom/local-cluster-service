const clusterService = require('./clusterService');
const storageService = require('./storageService');
const _ = require('lodash');

const DEFAULT_PORT_TYPE = 'rest';

class ServiceManager {

    constructor() {
        this._systems = storageService.get("services");
        if (!this._systems) {
            this._systems = {};
        }

        _.forEach(this._systems, (system) => {
            _.forEach(system, (services) => {
                _.forEach(services, (portInfo) => {
                    clusterService.reservePort(portInfo.port);
                });
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

    _ensureSystem(systemId) {
        if (!this._systems[systemId]) {
            this._systems[systemId] = {};
        }

        return this._systems[systemId];
    }

    _ensureService(systemId, serviceId) {

        const system = this._ensureSystem(systemId);

        if (!system[serviceId]) {
            system[serviceId] = {};
        }

        return system[serviceId];
    }

    async ensureServicePort(systemId, blockInstanceId, resourceName, portType) {
        if (!portType) {
            portType = DEFAULT_PORT_TYPE;
        }

        const service = this._ensureService(systemId, blockInstanceId);

        if (!service[portType]) {
            const port = await clusterService.getNextAvailablePort();
            service[portType] = {port};
            this._save();
        }

        const portTypeSection = service[portType];


        return portTypeSection.port;
    }

    _save() {
        storageService.put("services", this._systems);
    }

    /**
     * Gets the consumable address of a service block resource
     *
     * This returns a local proxy path to allow traffic inspection and control.
     *
     * @param {string} systemId
     * @param {string} consumerInstanceId
     * @param {string} consumerResourceName
     * @param {string} portType
     * @return {string}
     */
    getConsumerAddress(systemId, consumerInstanceId, consumerResourceName, portType) {
        const port = clusterService.getClusterServicePort();
        const path = clusterService.getProxyPath(systemId, consumerInstanceId, consumerResourceName, portType);
        return this._forLocal(port, path);
    }

    /**
     * Gets the direct address of a service block
     *
     * This returns the actual endpoint address of a service that we're talking to.
     * For local services this address will be on localhost - for remote services it will
     * be their remotely available address.
     *
     * @param {string} systemId
     * @param {string} providerInstanceId
     * @param {string} providerResourceName
     * @param {string} portType
     * @return {string}
     */
    async getProviderAddress(systemId, providerInstanceId, providerResourceName, portType) {
        const port = await this.ensureServicePort(systemId, providerInstanceId, providerResourceName, portType);
        return this._forLocal(port)
    }

    getServices() {
        return this._systems;
    }
}

module.exports = new ServiceManager();