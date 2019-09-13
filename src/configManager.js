const _ = require('lodash');
const serviceManager = require('./serviceManager');
const storageService = require('./storageService');

class ConfigManager {

    constructor() {
        this._config = storageService.section('config');
    }

    _forSystem(systemId) {
        if (!this._config[systemId]) {
            this._config[systemId] = {};
        }

        return this._config[systemId];
    }

    setConfigForService(systemId, serviceId, config) {
        const systemConfig = this._forSystem(systemId);
        systemConfig[serviceId] = config || {};

        storageService.put('config', systemId, systemConfig);
    }

    getConfigForService(systemId, serviceId) {
        const systemConfig = this._forSystem(systemId);

        if (!systemConfig[serviceId]) {
            systemConfig[serviceId] = {};
        }

        if (!systemConfig[serviceId].blockware) {
            systemConfig[serviceId].blockware = {};
        }

        const blockwareConfig = systemConfig[serviceId].blockware;

        if (!blockwareConfig.providers) {
            blockwareConfig.providers = {};
        }

        if (!blockwareConfig.consumers) {
            blockwareConfig.consumers = {};
        }

        _.extend(blockwareConfig.providers, serviceManager.getProvidersFor(systemId, serviceId));
        _.extend(blockwareConfig.consumers, serviceManager.getConsumersFor(systemId, serviceId));

        return systemConfig[serviceId];
    }
}

module.exports = new ConfigManager();