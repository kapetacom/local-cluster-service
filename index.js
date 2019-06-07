const clusterService = require('./src/clusterService');
const express = require('express');

let currentServer = null;

function createServer() {
    const app = express();
    app.use('/traffic', require('./src/traffic/routes'));
    app.use('/proxy', require('./src/proxy/routes'));
    app.use('/config', require('./src/config/routes'));

    return app;
}

module.exports = {
    /**
     * Starts the local cluster service.
     * @param {integer} [port] An optional port.
     * @return {Promise<Integer>} resolves when listening is done with port number. Rejects if listening failed.
     */
    start: function(port) {
        if (currentServer) {
            return Promise.reject(new Error('Server already started'));
        }

        currentServer = createServer();
        if (port) {
            clusterService.setClusterServicePort(port);
        } else {
            port = clusterService.getClusterServicePort();
        }

        return new Promise((resolve, reject) => {

            currentServer.once('error', (err) => {
                currentServer.close();
                currentServer = null;
                reject(err);
            });

            currentServer.listen(port, () => resolve(port));
        });
    },

    /**
     * Stops any currently running cluster services.
     * @return {boolean} Returns true if the service was stopped - false if no service was running.
     */
    stop: function() {
        if (currentServer) {
            currentServer.close();
            currentServer = null;
            return true;
        }

        return false;
    }
};

