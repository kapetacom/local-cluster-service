class NetworkManager {

    constructor() {
        this._traffic = {};
    }

    _ensureService(serviceId) {
        if (!this._traffic[serviceId]) {
            this._traffic[serviceId] = [];
        }

        return this._traffic[serviceId];
    }

    addRequest(fromServiceId, toServiceId, request) {
        const traffic = new Traffic(fromServiceId, toServiceId, request);
        this._ensureService(toServiceId).push(traffic);

        return traffic;
    }

    getTrafficForService(serviceId) {
        return this._ensureService(serviceId);
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