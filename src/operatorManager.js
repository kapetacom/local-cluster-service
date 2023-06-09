const ClusterConfiguration = require('@kapeta/local-cluster-config');
const serviceManager = require('./serviceManager');
const storageService = require('./storageService');
const containerManager = require('./containerManager');
const _ = require('lodash');
const mkdirp = require('mkdirp');
const Path = require('path');
const md5 = require('md5');

const KIND_OPERATOR = 'core/resource-type-operator';

class Operator {
    constructor(data) {
        this._data = data;
    }

    getData() {
        return this._data;
    }

    getCredentials() {
        return this._data.credentials;
    }
}

class OperatorManager {

    constructor() {
        this._mountDir = Path.join(storageService.getKapetaBasedir(), 'mounts');

        mkdirp.sync(this._mountDir);
    }

    _getMountPoint(operatorType, mountName) {
        return Path.join(this._mountDir, operatorType, mountName);
    }

    /**
     * Get operator definition for resource type
     *
     * @param resourceType
     * @return {Operator}
     */
    getOperator(resourceType) {
        const operators = ClusterConfiguration.getDefinitions(KIND_OPERATOR);

        const operator = _.find(operators, (operator) => operator.definition &&
            operator.definition.metadata &&
            operator.definition.metadata.name &&
            operator.definition.metadata.name.toLowerCase() === resourceType.toLowerCase());

        if (!operator) {
            throw new Error('Unknown resource type: ' + resourceType);
        }

        if (!operator.definition.spec ||
            !operator.definition.spec.local) {
            throw new Error('Operator missing local definition: ' + resourceType);
        }

        return new Operator(operator.definition.spec.local);
    }

    /**
     * Get information about a specific resource
     *
     * @param {string} systemId
     * @param {string} fromServiceId
     * @param {string} resourceType
     * @param {string} portType
     * @param {string} name
     * @returns {Promise<{host: string, port: (*|string), type: *, protocol: *, credentials: *}>}
     */
    async getResourceInfo(systemId, fromServiceId, resourceType, portType, name, environment) {

        const operator = this.getOperator(resourceType);

        const credentials = operator.getCredentials();

        const container = await this.ensureResource(systemId, resourceType);

        const portInfo = await container.getPort(portType);

        if (!portInfo) {
            throw new Error('Unknown resource port type : ' + resourceType + '#' + portType);
        }

        const dbName = name + '_' + fromServiceId.replace(/[^a-z0-9]/gi, '');

        return {
            host: environment === 'docker' ? 'host.docker.internal' : '127.0.0.1',
            port: portInfo.hostPort,
            type: portType,
            protocol: portInfo.protocol,
            options: {
                dbName
            },
            credentials
        };
    }

    /**
     * Ensure we have a running operator of given type
     *
     * @param systemId
     * @param resourceType
     * @return {Promise<ContainerInfo>}
     */
    async ensureResource(systemId, resourceType) {
        const operator = this.getOperator(resourceType);

        const operatorData = operator.getData();

        const portTypes = Object.keys(operatorData.ports);

        portTypes.sort();

        const containerBaseName = 'kapeta-resource';

        const nameParts = [resourceType.toLowerCase()];

        const ports = {};

        for(let i = 0 ; i < portTypes.length; i++) {
            const portType = portTypes[i];
            let containerPortInfo = operatorData.ports[portType];
            const hostPort = await serviceManager.ensureServicePort(resourceType, portType);

            if (typeof containerPortInfo === 'number' ||
                typeof containerPortInfo === 'string') {
                containerPortInfo = {port: containerPortInfo, type: 'tcp'};
            }

            if (!containerPortInfo.type) {
                containerPortInfo.type = 'tcp';
            }

            const portId = containerPortInfo.port + '/' + containerPortInfo.type;
            nameParts.push(portType + '-' + portId + '-' + hostPort);

            ports[portId] = {
                type: portType,
                hostPort
            };
        }

        const mounts = containerManager.createMounts(resourceType, operatorData.mounts);

        const containerName = containerBaseName + '-' + md5(nameParts.join('_'));
        let container = await containerManager.get(containerName);

        const isRunning = container ? await container.isRunning() : false;
        if (container && !isRunning) {
            await container.start();
        }

        if (!container) {

            container = await containerManager.run(
                operatorData.image,
                containerName,
                {
                    mounts,
                    ports,
                    health: operatorData.health,
                    env: operatorData.env,
                    cmd: operatorData.cmd
                });
        }

        try {
            if (operatorData.health) {
                await containerManager.waitForHealthy(container.native);
            } else {
                await containerManager.waitForReady(container.native);
            }
        } catch (e) {
            console.error(e.message);
        }

        return container;
    }
}

module.exports = new OperatorManager();
