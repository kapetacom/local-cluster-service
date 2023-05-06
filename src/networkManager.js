const uuid = require('node-uuid');
class NetworkManager {

    static toConnectionId(connection) {
        return [
            connection.provider.blockId,
            connection.provider.resourceName,
            connection.consumer.blockId,
            connection.consumer.resourceName
        ].join('_');
    }

    constructor() {
        this._connections = {};
        this._sources = {};
        this._targets = {};
    }

    _ensureSystem(systemId) {
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

    _ensureConnection(systemId, connectionId) {
        this._ensureSystem(systemId);

        if (!this._connections[systemId][connectionId]) {
            this._connections[systemId][connectionId] = [];
        }

        return this._connections[systemId][connectionId];
    }

    _ensureSource(systemId, sourceBlockInstanceId) {
        this._ensureSystem(systemId);

        if (!this._sources[systemId][sourceBlockInstanceId]) {
            this._sources[systemId][sourceBlockInstanceId] = [];
        }

        return this._sources[systemId][sourceBlockInstanceId];
    }

    _ensureTarget(systemId, targetBlockInstanceId) {
        this._ensureSystem(systemId);

        if (!this._targets[systemId][targetBlockInstanceId]) {
            this._targets[systemId][targetBlockInstanceId] = [];
        }

        return this._targets[systemId][targetBlockInstanceId];
    }

    addRequest(systemId, connection, request, consumerMethodId, providerMethodId) {

        const traffic = new Traffic(connection, request, consumerMethodId, providerMethodId);

        this._ensureConnection(systemId, traffic.connectionId).push(traffic);
        this._ensureSource(systemId, connection.provider.blockId).push(traffic);
        this._ensureTarget(systemId, connection.consumer.blockId).push(traffic);

        return traffic;
    }

    getTrafficForConnection(systemId, connectionId) {
        return this._ensureConnection(systemId, connectionId);
    }

    getTrafficForSource(systemId, blockInstanceId) {

        return this._ensureSource(systemId, blockInstanceId);
    }

    getTrafficForTarget(systemId, blockInstanceId) {
        return this._ensureTarget(systemId, blockInstanceId);
    }
}


class Traffic {

    constructor(connection, request, consumerMethodId, providerMethodId) {
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

    asError(err) {
        this.ended = new Date().getTime();
        this.response = {
            code: 0,
            headers: {},
            body: null
        };
        this.error = err + '';
    }

    withResponse(response) {
        this.ended = new Date().getTime();
        this.response = response;
    }

}

module.exports = new NetworkManager();