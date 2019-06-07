const _ = require('lodash');
const serviceManager = require('./serviceManager');
const storageService = require('./storageService');

class ConfigManager {

    constructor() {
        this._config = storageService.section('config');
    }

    setConfigForService(serviceId, config) {
        this._config[serviceId] = config || {};

        storageService.put('config', serviceId, this._config[serviceId]);
    }

    getConfigForService(serviceId) {
        if (!this._config[serviceId]) {
            this._config[serviceId] = {};
        }

        if (!this._config[serviceId].blockware) {
            this._config[serviceId].blockware = {};
        }

        const blockwareConfig = this._config[serviceId].blockware;

        if (!blockwareConfig.providers) {
            blockwareConfig.providers = {};
        }

        if (!blockwareConfig.consumers) {
            blockwareConfig.consumers = {};
        }

        _.extend(blockwareConfig.providers, serviceManager.getProvidersFor(serviceId));
        _.extend(blockwareConfig.consumers, serviceManager.getConsumersFor(serviceId));

        return this._config[serviceId];
    }
}

module.exports = new ConfigManager();