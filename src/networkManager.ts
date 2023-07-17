import uuid from 'node-uuid';

import { Connection, SimpleRequest, SimpleResponse } from './types.js';

class NetworkManager {
    private _connections: { [systemId: string]: { [connectionId: string]: Traffic[] } };
    private _sources: { [systemId: string]: { [instanceId: string]: Traffic[] } };
    private _targets: { [systemId: string]: { [instanceId: string]: Traffic[] } };

    static toConnectionId(connection: Connection) {
        return [
            connection.provider.blockId,
            connection.provider.resourceName,
            connection.consumer.blockId,
            connection.consumer.resourceName,
        ].join('_');
    }

    constructor() {
        this._connections = {};
        this._sources = {};
        this._targets = {};
    }

    _ensureSystem(systemId: string) {
        if (!this._connections[systemId]) {
            this._connections[systemId] = {};
        }

        if (!this._sources[systemId]) {
            this._sources[systemId] = {};
        }

        if (!this._targets[systemId]) {
            this._targets[systemId] = {};
        }
    }

    _ensureConnection(systemId: string, connectionId: string) {
        this._ensureSystem(systemId);

        if (!this._connections[systemId][connectionId]) {
            this._connections[systemId][connectionId] = [];
        }

        return this._connections[systemId][connectionId];
    }

    _ensureSource(systemId: string, sourceBlockInstanceId: string) {
        this._ensureSystem(systemId);

        if (!this._sources[systemId][sourceBlockInstanceId]) {
            this._sources[systemId][sourceBlockInstanceId] = [];
        }

        return this._sources[systemId][sourceBlockInstanceId];
    }

    _ensureTarget(systemId: string, targetBlockInstanceId: string) {
        this._ensureSystem(systemId);

        if (!this._targets[systemId][targetBlockInstanceId]) {
            this._targets[systemId][targetBlockInstanceId] = [];
        }

        return this._targets[systemId][targetBlockInstanceId];
    }

    addRequest(
        systemId: string,
        connection: Connection,
        request: SimpleRequest,
        consumerMethodId?: string,
        providerMethodId?: string
    ) {
        const traffic = new Traffic(connection, request, consumerMethodId, providerMethodId);

        this._ensureConnection(systemId, traffic.connectionId).push(traffic);
        this._ensureSource(systemId, connection.provider.blockId).push(traffic);
        this._ensureTarget(systemId, connection.consumer.blockId).push(traffic);

        return traffic;
    }

    getTrafficForConnection(systemId: string, connectionId: string) {
        return this._ensureConnection(systemId, connectionId);
    }

    getTrafficForSource(systemId: string, blockInstanceId: string) {
        return this._ensureSource(systemId, blockInstanceId);
    }

    getTrafficForTarget(systemId: string, blockInstanceId: string) {
        return this._ensureTarget(systemId, blockInstanceId);
    }
}

class Traffic {
    public readonly id: string;
    public readonly connectionId: string;
    public readonly consumerMethodId: string | undefined;
    public readonly providerMethodId: string | undefined;
    public readonly created: number;
    public readonly request: SimpleRequest;
    public ended: null | number;
    public error: null | string;
    public response: SimpleResponse | null;

    constructor(connection: Connection, request: SimpleRequest, consumerMethodId?: string, providerMethodId?: string) {
        this.id = uuid.v4();
        this.connectionId = NetworkManager.toConnectionId(connection);
        this.consumerMethodId = consumerMethodId;
        this.providerMethodId = providerMethodId;
        this.request = request;
        this.response = null;
        this.error = null;
        this.ended = null;
        this.created = new Date().getTime();
    }

    asError(err: any) {
        this.ended = new Date().getTime();
        this.response = {
            code: 0,
            headers: {},
            body: null,
        };
        this.error = err + '';
    }

    withResponse(response: SimpleResponse) {
        this.ended = new Date().getTime();
        this.response = response;
    }
}

export const networkManager = new NetworkManager();
