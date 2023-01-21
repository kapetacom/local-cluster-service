const clusterService = require('./src/clusterService');
const storageService = require('./src/storageService');
const serviceManager = require('./src/serviceManager');
const socketManager = require('./src/socketManager');
const containerManager = require('./src/containerManager');
const express = require('express');
const HTTP = require('http');
const {Server} = require("socket.io");

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
    const io = new Server(server, {
        cors: {
            //TODO: This should'nt be hardcoded but also shouldn't be "*"
            origin: "http://localhost:8080"
        }
    });
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
            throw new Error('Server already started');
        }

        try {
            await containerManager.ping()
        } catch (e) {
            throw new Error('Could not ping docker runtime: ' + e.toString() + '. Make sure docker is running and working.');
        }

        const clusterPort = storageService.get('cluster','port');
        if (clusterPort) {
            clusterService.setClusterServicePort(clusterPort);
        }

        const clusterHost = storageService.get('cluster','host');
        if (clusterHost) {
            clusterService.setClusterServiceHost(clusterHost);
        }

        await clusterService.init();

        currentServer = createServer();

        const port = clusterService.getClusterServicePort();

        const host = clusterService.getClusterServiceHost();

        if (clusterPort !== port) {
            storageService.put('cluster','port', port);
        }

        if (clusterHost !== host) {
            storageService.put('cluster','host', host);
        }

        return new Promise((resolve, reject) => {

            currentServer.once('error', (err) => {
                currentServer.close();
                currentServer = null;
                reject(err);
            });

            currentServer.listen(port, host, () => resolve({host,port}));
            currentServer.host = host;
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

