/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

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
import AttachmentRoutes from './src/attachments/routes';
import TaskRoutes from './src/tasks/routes';
import APIRoutes from './src/api';
import { getBindHost } from './src/utils/utils';
import request from 'request';
import { repositoryManager } from './src/repositoryManager';
import { taskManager } from './src/taskManager';
import { ensureCLI, ensureCLICommands } from './src/utils/commandLineUtils';
import { defaultProviderInstaller } from './src/utils/DefaultProviderInstaller';
import { authManager } from './src/authManager';
import { codeGeneratorManager } from './src/codeGeneratorManager';

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
    app.use('/attachments', AttachmentRoutes);
    app.use('/tasks', TaskRoutes);
    app.use('/api', APIRoutes);

    app.get('/status', async (req, res) => {
        res.send({
            ok: true,
            dockerStatus: await containerManager.checkAlive(),
            socketStatus: socketManager.isAlive(),
        });
    });

    app.get('/ping', async (req, res) => {
        res.send({
            ok: true,
        });
    });

    app.use('/', (req: express.Request, res: express.Response) => {
        console.error('Invalid request: %s %s', req.method, req.originalUrl);
        res.status(400).json({
            ok: false,
            error: 'Unknown',
        });
    });

    /**
     * Central error handler, allows us to return a consistent JSON response wrapper with the error.
     */
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('Error handling request: %s %s', req.method, req.originalUrl, err);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message || 'Unknown error',
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
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

    ping: async function (host: string, port: number): Promise<{ ok: boolean }> {
        return new Promise((resolve, reject) => {
            request.get(`http://${host}:${port}/ping`, (err, res, body) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(JSON.parse(body));
            });
        });
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
            console.log('Testing docker runtime...');
            await containerManager.initialize();
        } catch (e: any) {
            console.error(
                'Could not ping docker runtime: ' + e.toString() + '. Make sure docker is running and working.'
            );
        }

        await defaultProviderInstaller.checkForDefault();
        await codeGeneratorManager.initialize();

        const clusterPort = storageService.get('cluster', 'port');
        if (clusterPort) {
            clusterService.setClusterServicePort(clusterPort);
        }

        const clusterHost = storageService.get('cluster', 'host');
        if (clusterHost) {
            clusterService.setClusterServiceHost(clusterHost);
        }

        let pingResult = undefined;
        try {
            pingResult = await this.ping(clusterHost, clusterPort);
        } catch (e: any) {
            //Ignore - expected to not be running since we're starting it
        }

        if (pingResult?.ok) {
            throw new Error(`Cluster service already running on: ${clusterHost}:${clusterPort}.`);
        }

        await clusterService.init();

        authManager.listenForChanges();

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

            const bindHost = getBindHost(host);

            currentServer.listen(port, bindHost, async () => {
                try {
                    const ensureCLITask = await ensureCLI();
                    if (ensureCLITask) {
                        await taskManager.waitFor((t) => t === ensureCLITask);
                    }
                } catch (e: any) {
                    console.error('Failed to install CLI.', e);
                }

                try {
                    await ensureCLICommands();
                } catch (error) {
                    console.error('Failed to ensure default CLI commands', error);
                }

                try {
                    // Start installation process for all default providers
                    await repositoryManager.ensureDefaultProviders();
                } catch (e: any) {
                    console.error('Failed to install default providers.', e);
                }

                resolve({ host, port, dockerStatus: containerManager.isAlive() });
            });
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
