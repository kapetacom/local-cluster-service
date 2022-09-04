const net = require('net');
const DEFAULT_SERVER_PORT = 35100;
const DEFAULT_START_PORT = 40000;
const DEFAULT_HOST = '127.0.0.1';

class ClusterService {

    constructor() {
        this._port = DEFAULT_SERVER_PORT;
        this._currentPort = DEFAULT_START_PORT;
        this._initialized = false;
        this._reservedPorts = [];
        this._host = DEFAULT_HOST;
    }

    reservePort(port) {
        const intPort = parseInt(port);
        if (this._reservedPorts.indexOf(intPort) > -1) {
            throw new Error('Port already reserved: ' + intPort);
        }

        this._reservedPorts.push(intPort);
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
     * @return {Promise<number>}
     */
    async getNextAvailablePort() {
        while(true) {

            while (this._reservedPorts.indexOf(this._currentPort) > -1) {
                this._currentPort++;
            }

            const nextPort = this._currentPort++;
            const isUsed = await this._checkIfPortIsUsed(nextPort);
            if (!isUsed) {
                return nextPort;
            }
        }
    }

    _checkIfPortIsUsed(port, host=this._host) {
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

            server.listen( port, host );
        });

    }


    /**
     * The port of this local cluster service itself
     */
    getClusterServicePort() {
        return this._port;
    }
    
    /* 
     *Gets the host name ( 127.0.0.1 ) on which Express JS is listening
     */
     getClusterServiceHost() {
        return this._host;
    }

    /**
     * Set the port to be used for this local service
     * @param port
     */
    setClusterServicePort(port) {
        this._port = port;
    }

    setClusterServiceHost(host) {
        this._host = host;
    }

    /**
     * Gets that proxy path of a given request
     *
     * @param systemId
     * @param consumerInstanceId
     * @param consumerResourceName
     * @param portType
     * @return {string}
     */
    getProxyPath(systemId, consumerInstanceId, consumerResourceName, portType) {
        return `/proxy/${encodeURIComponent(systemId)}/${encodeURIComponent(consumerInstanceId)}/${encodeURIComponent(consumerResourceName)}/${encodeURIComponent(portType)}/`;
    }
}

module.exports = new ClusterService();