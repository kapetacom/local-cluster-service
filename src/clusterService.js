const net = require('net');

const DEFAULT_SERVER_PORT = 30033;
const DEFAULT_START_PORT = 40000;

class ClusterService {

    constructor() {
        this._currentPort = DEFAULT_START_PORT;
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
                    resolve(true);
                    return;
                }

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
        return DEFAULT_SERVER_PORT;
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