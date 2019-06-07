const net = require('net');
const DEFAULT_SERVER_PORT = 35100;
const DEFAULT_START_PORT = 40000;

class ClusterService {

    constructor() {
        this._port = DEFAULT_SERVER_PORT;
        this._currentPort = DEFAULT_START_PORT;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) {
            return;
        }

        this._initialized = true;
        await this._findClusterServicePort();

    }

    async _findClusterServicePort() {
        while(true) {

            const isUsed = await this._checkIfPortIsUsed(this._port);
            if (!isUsed) {
                break;
            }

            this._port++;
        }
    }


    /**
     * Gets next available port
     * @return {number}
     */
    async getNextAvailablePort() {
        while(true) {
            const nextPort = this._currentPort++;
            const isUsed = await this._checkIfPortIsUsed(nextPort);
            if (!isUsed) {
                return nextPort;
            }
        }
    }

    _checkIfPortIsUsed(port) {
        return new Promise((resolve, reject) => {
            const server = net.createServer();

            server.once('error', function(err) {
                if (err.code === 'EADDRINUSE') {
                    server.close();
                    resolve(true);
                    return;
                }

                server.close();
                reject(err);
            });

            server.once('listening', function() {
                server.close();
                resolve(false);
            });

            server.listen( port );
        });

    }


    /**
     * The port of this local cluster service itself
     */
    getClusterServicePort() {
        return this._port;
    }

    /**
     * Set the port to be used for this local service
     * @param port
     */
    setClusterServicePort(port) {
        this._port = port;
    }

    /**
     * Gets that proxy path of a given request
     *
     * @param fromServiceId
     * @param toServiceId
     * @param portType
     * @return {string}
     */
    getProxyPath(fromServiceId, toServiceId, portType) {
        return `/proxy/${fromServiceId}/${toServiceId}/${portType}/`;
    }
}

module.exports = new ClusterService();