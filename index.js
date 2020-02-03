const clusterService = require('./src/clusterService');
const storageService = require('./src/storageService');
const serviceManager = require('./src/serviceManager');
const socketManager = require('./src/socketManager');
const express = require('express');
const HTTP = require('http');

let currentServer = null;

function createServer() {
    const app = express();
    app.use('/traffic', require('./src/traffic/routes'));
    app.use('/proxy', require('./src/proxy/routes'));
    app.use('/config', require('./src/config/routes'));
    app.use('/instances', require('./src/instances/routes'));
    app.use('/files', require('./src/filesystem/routes'));
    app.use('/assets', require('./src/assets/routes'));
    app.use('/providers', require('./src/providers/routes'));
    const server = HTTP.createServer(app);

    //socket 
    io = require("socket.io")(server);
    socketManager.setIo(io);
    return server;
}

module.exports = {

    isRunning: function() {
        return !!currentServer;
    },

    getCurrentPort: function() {
        if (!currentServer) {
            return -1;
        }

        return currentServer.port;
    },

    /**
     * Starts the local cluster service.
     * @return {Promise<Integer>} resolves when listening is done with port number. Rejects if listening failed.
     */
    start: async function() {
        if (currentServer) {
            return Promise.reject(new Error('Server already started'));
        }

        const clusterPort = storageService.get('cluster','port');
        if (clusterPort) {
            clusterService.setClusterServicePort(clusterPort);
        }

        await clusterService.init();

        currentServer = createServer();

        const port = clusterService.getClusterServicePort();

        const ip = clusterService.getClusterServiceIp();

        if (clusterPort !== port) {
            storageService.put('cluster','port', port);
        }

        return new Promise((resolve, reject) => {

            currentServer.once('error', (err) => {
                currentServer.close();
                currentServer = null;
                reject(err);
            });

            currentServer.listen(port, ip, () => resolve(port));
            currentServer.port = port;
        });
    },

    /**
     * Stops any currently running cluster services.
     * @return {Promise<boolean>} Returns true if the service was stopped - false if no service was running.
     */
    stop: function() {
        if (currentServer) {
            return new Promise(function(resolve) {
                currentServer.close(() => resolve(true));
                currentServer = null;
            });
        }

        return Promise.resolve(false);
    },
    getServices: () => serviceManager.getServices()
};

