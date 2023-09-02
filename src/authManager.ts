import { EventEmitter } from 'node:events';
import Path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { WatchEventName } from './types';
import { definitionsManager } from './definitionsManager';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { socketManager } from './socketManager';

class AuthManager extends EventEmitter {
    private watcher?: FSWatcher;

    private hadToken: boolean;

    constructor() {
        super();
        this.hadToken = this.hasToken();
    }

    public listenForChanges() {
        const parentDir = Path.dirname(ClusterConfiguration.getKapetaBasedir());
        //We watch the parent dir to catch changes to the base dir itself
        this.watcher = chokidar.watch(parentDir, {
            followSymlinks: false,
            ignorePermissionErrors: true,
            disableGlobbing: true,
            persistent: true,
            ignoreInitial: true,
            depth: 1,
            ignored: (path) => {
                return !path.startsWith(ClusterConfiguration.getKapetaBasedir());
            },
        });
        this.watcher.add(ClusterConfiguration.getKapetaBasedir());
        this.watcher.on('all', this.handleFileChange.bind(this));
        this.watcher.on('error', (error) => {
            console.log('Error watching repository', error);
        });
        this.watcher.on('ready', () => {
            console.log('Watching for auth changes: %s', ClusterConfiguration.getKapetaBasedir());
        });
    }

    private hasToken() {
        const api = new KapetaAPI();
        return api.hasToken();
    }

    private async handleFileChange(eventName: WatchEventName, path: string) {
        const hasTokenNow = this.hasToken();
        if (this.hadToken !== hasTokenNow) {
            socketManager.emitGlobal('auth-change', {});
            if (hasTokenNow) {
                // Clear the cache in case we need to rewrite the sample plan
                definitionsManager.clearCache();
            }
            this.hadToken = hasTokenNow;
        }
    }
}

export const authManager = new AuthManager();
