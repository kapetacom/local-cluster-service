const ClusterConfiguration = require('@kapeta/local-cluster-config').default;
const serviceManager = require('./serviceManager');
const storageService = require('./storageService');
const containerManager = require('./containerManager');
const _ = require('lodash');
const mkdirp = require('mkdirp');
const Path = require('path');
const md5 = require('md5');
const {parseKapetaUri} = require("@kapeta/nodejs-utils");

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
     * @param {string} resourceType
     * @param {string} version
     * @return {Operator}
     */
    getOperator(resourceType, version) {
        const operators = ClusterConfiguration.getDefinitions(KIND_OPERATOR);

        const operator = _.find(operators, (operator) => operator.definition &&
            operator.definition.metadata &&
            operator.definition.metadata.name &&
            operator.definition.metadata.name.toLowerCase() === resourceType.toLowerCase() &&
            operator.version === version);

        if (!operator) {
            throw new Error(`Unknown resource type: ${resourceType}:${version}`);
        }

        if (!operator.definition.spec ||
            !operator.definition.spec.local) {
            throw new Error(`Operator missing local definition: ${resourceType}:${version}`);
        }

        return new Operator(operator.definition.spec.local);
    }

    /**
     * Get information about a specific consumed resource
     *
     * @param {string} systemId
     * @param {string} fromServiceId
     * @param {string} resourceType
     * @param {string} portType
     * @param {string} name
     * @returns {Promise<{host: string, port: (*|string), type: *, protocol: *, credentials: *}>}
     */
    async getConsumerResourceInfo(systemId, fromServiceId, resourceType, portType, name, environment) {

        const plans = ClusterConfiguration.getDefinitions('core/plan');

        const planUri = parseKapetaUri(systemId);
        const currentPlan = plans.find(plan => plan.definition.metadata.name === planUri.fullName && plan.version === planUri.version);
        if (!currentPlan) {
            throw new Error(`Unknown plan: ${systemId}`);
        }

        const currentInstance = currentPlan.definition.spec.blocks?.find(instance => instance.id === fromServiceId);
        if (!currentInstance) {
            throw new Error(`Unknown instance: ${fromServiceId} in plan ${systemId}`);
        }

        const blockUri = parseKapetaUri(currentInstance.block.ref);
        const blockDefinition = ClusterConfiguration.getDefinitions().find(definition =>
            definition.version === blockUri.version &&
            definition.definition.metadata.name === blockUri.fullName
        );

        if (!blockDefinition) {
            throw new Error(`Unknown block: ${currentInstance.block.ref} in plan ${systemId}`);
        }

        const blockResource = blockDefinition.definition.spec?.consumers?.find(resource => resource.metadata.name === name);
        if (!blockResource) {
            throw new Error(`Unknown resource: ${name} in block ${currentInstance.block.ref} in plan ${systemId}`);
        }

        const kindUri = parseKapetaUri(blockResource.kind);
        const operator = this.getOperator(resourceType, kindUri.version);
        const credentials = operator.getCredentials();
        const container = await this.ensureResource(systemId, resourceType, kindUri.version);
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
     * @param {string} systemId
     * @param {string} resourceType
     * @param {string} version
     * @return {Promise<ContainerInfo>}
     */
    async ensureResource(systemId, resourceType, version) {
        const operator = this.getOperator(resourceType, version);

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
