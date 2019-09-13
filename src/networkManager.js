class NetworkManager {

    constructor() {
        this._traffic = {};
    }

    _ensureService(systemId, serviceId) {
        if (!this._traffic[systemId]) {
            this._traffic[systemId] = {};
        }

        if (!this._traffic[systemId][serviceId]) {
            this._traffic[systemId][serviceId] = [];
        }

        return this._traffic[systemId][serviceId];
    }

    addRequest(systemId, fromServiceId, toServiceId, request) {
        const traffic = new Traffic(fromServiceId, toServiceId, request);
        this._ensureService(systemId, toServiceId).push(traffic);

        return traffic;
    }

    getTrafficForService(systemId, serviceId) {
        return this._ensureService(systemId, serviceId);
    }
}


class Traffic {

    constructor(fromServiceId, toServiceId, request) {
        this.fromServiceId = fromServiceId;
        this.toServiceId = toServiceId;
        this.request = request;
        this.response = null;
        this.ended = null;
        this.error = null;
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