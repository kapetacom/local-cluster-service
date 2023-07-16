import { clusterService } from './src/clusterService';
import { storageService } from './src/storageService';
import { serviceManager } from './src/serviceManager';
import { socketManager } from './src/socketManager';
import { containerManager } from './src/containerManager';
import express from 'express';
import HTTP from 'http';
import { Server } from 'socket.io';

import TrafficRoutes from './src/traffic/routes';
import ProxyRoutes from './src/proxy/routes';
import ConfigRoutes from './src/config/routes';
import InstancesRoutes from './src/instances/routes';
import IdentitiesRoutes from './src/identities/routes';
import FilesystemRoutes from './src/filesystem/routes';
import AssetsRoutes from './src/assets/routes';
import ProviderRoutes from './src/providers/routes';

export type LocalClusterService = HTTP.Server & { host?: string; port?: number };

export type StartResult = { host: string; port: number; dockerStatus: boolean };

let currentServer: LocalClusterService | null = null;

function createServer() {
    const app = express();
    app.use('/traffic', TrafficRoutes);
    app.use('/proxy', ProxyRoutes);
    app.use('/config', ConfigRoutes);
    app.use('/instances', InstancesRoutes);
    app.use('/identities', IdentitiesRoutes);
    app.use('/files', FilesystemRoutes);
    app.use('/assets', AssetsRoutes);
    app.use('/providers', ProviderRoutes);
    app.use('/', (err: any, req: express.Request, res: express.Response) => {
        console.error('Request failed: %s %s', req.method, req.originalUrl, err);
        res.status(500).send({
            ok: false,
            error: err.error ?? err.message,
        });
    });
    const server = HTTP.createServer(app);

    //socket
    const io = new Server(server, {
        cors: {
            //TODO: This should'nt be hardcoded but also shouldn't be "*"
            origin: 'http://localhost:8080',
        },
    });
    socketManager.setIo(io);
    return server;
}

export default {
    isRunning: function () {
        return !!currentServer;
    },

    getCurrentPort: function () {
        if (!currentServer) {
            return -1;
        }

        return currentServer.port;
    },

    /**
     * Starts the local cluster service.
     * resolves when listening is done with port number. Rejects if listening failed.
     */
    start: async function (): Promise<StartResult> {
        if (currentServer) {
            throw new Error('Server already started');
        }

        try {
            await containerManager.initialize();
        } catch (e: any) {
            console.error(
                'Could not ping docker runtime: ' + e.toString() + '. Make sure docker is running and working.'
            );
        }

        const clusterPort = storageService.get('cluster', 'port');
        if (clusterPort) {
            clusterService.setClusterServicePort(clusterPort);
        }

        const clusterHost = storageService.get('cluster', 'host');
        if (clusterHost) {
            clusterService.setClusterServiceHost(clusterHost);
        }

        await clusterService.init();

        currentServer = createServer();

        const port = clusterService.getClusterServicePort();

        const host = clusterService.getClusterServiceHost();

        if (clusterPort !== port) {
            storageService.put('cluster', 'port', port);
        }

        if (clusterHost !== host) {
            storageService.put('cluster', 'host', host);
        }

        return new Promise((resolve, reject) => {
            if (!currentServer) {
                reject(new Error(`Current server wasn't set`));
                return;
            }
            currentServer.once('error', (err) => {
                if (currentServer) {
                    currentServer.close();
                    currentServer = null;
                }
                reject(err);
            });

            currentServer.listen(port, host, () => resolve({ host, port, dockerStatus: containerManager.isAlive() }));
            currentServer.host = host;
            currentServer.port = port;
        });
    },

    /**
     * Stops any currently running cluster services.
     * @return {Promise<boolean>} Returns true if the service was stopped - false if no service was running.
     */
    stop: function () {
        if (currentServer) {
            return new Promise(function (resolve) {
                if (currentServer) {
                    currentServer.close(() => resolve(true));
                    currentServer = null;
                }
            });
        }

        return Promise.resolve(false);
    },
    getServices: () => serviceManager.getServices(),
};
