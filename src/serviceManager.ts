/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import _ from 'lodash';
import { clusterService } from './clusterService';
import { storageService } from './storageService';
import { EnvironmentType } from './types';
import { normalizeKapetaUri } from '@kapeta/nodejs-utils';
import { resolvePortType } from './utils/BlockInstanceRunner';

export const HTTP_PORT_TYPE = 'http';

export const DEFAULT_PORT_TYPE = HTTP_PORT_TYPE;

export const HTTP_PORTS = [HTTP_PORT_TYPE, 'web', 'rest'];

class ServiceManager {
    private _systems: any;

    constructor() {
        this._systems = storageService.get('services');
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

    _forLocal(port: string | number, path?: string, environmentType?: EnvironmentType) {
        if (!path) {
            path = '';
        }
        let host;
        if (environmentType === 'docker') {
            //We're inside a docker container, so we can use this special host name to access the host machine
            host = 'host.docker.internal';
        } else {
            host = clusterService.getClusterServiceHost();
        }

        if (path.startsWith('/')) {
            path = path.substring(1);
        }
        return `http://${host}:${port}/${path}`;
    }

    _ensureSystem(systemId: string) {
        systemId = normalizeKapetaUri(systemId);

        if (!this._systems[systemId]) {
            this._systems[systemId] = {};
        }

        return this._systems[systemId];
    }

    _ensureService(systemId: string, serviceId: string) {
        const system = this._ensureSystem(systemId);

        if (!system[serviceId]) {
            system[serviceId] = {};
        }

        return system[serviceId];
    }

    async ensureServicePort(systemId: string, blockInstanceId: string, portType: string = DEFAULT_PORT_TYPE) {
        systemId = normalizeKapetaUri(systemId);
        if (!portType) {
            portType = DEFAULT_PORT_TYPE;
        }

        portType = resolvePortType(portType);

        const service = this._ensureService(systemId, blockInstanceId);

        if (!service[portType]) {
            const port = await clusterService.getNextAvailablePort();
            service[portType] = { port };
            this._save();
        }

        const portTypeSection = service[portType];

        return portTypeSection.port;
    }

    _save() {
        storageService.put('services', this._systems);
    }

    /**
     * Gets the consumable address of a service block resource
     *
     * This returns a local proxy path to allow traffic inspection and control.
     *
     */
    getConsumerAddress(
        systemId: string,
        consumerInstanceId: string,
        consumerResourceName: string,
        portType: string,
        environmentType?: EnvironmentType
    ): string {
        systemId = normalizeKapetaUri(systemId);
        const port = clusterService.getClusterServicePort();
        const path = clusterService.getProxyPath(systemId, consumerInstanceId, consumerResourceName, portType);
        return this._forLocal(port, path, environmentType);
    }

    /**
     * Gets the direct address of a service block
     *
     * This returns the actual endpoint address of a service that we're talking to.
     * For local services this address will be on localhost - for remote services it will
     * be their remotely available address.
     *
     */
    async getProviderAddress(systemId: string, providerInstanceId: string, portType: string): Promise<string> {
        systemId = normalizeKapetaUri(systemId);
        const port = await this.ensureServicePort(systemId, providerInstanceId, portType);
        return this._forLocal(port);
    }

    getServices() {
        return this._systems;
    }
}

export const serviceManager = new ServiceManager();
