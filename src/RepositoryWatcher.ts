import chokidar, { FSWatcher } from 'chokidar';
import ClusterConfiguration, { Definition, DefinitionInfo } from '@kapeta/local-cluster-config';
import FS from 'fs-extra';
import Path from 'node:path';
import YAML from 'yaml';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import _ from 'lodash';
import { socketManager } from './socketManager';
import { SourceOfChange, WatchEventName } from './types';
import { cacheManager } from './cacheManager';
import { EventEmitter } from 'node:events';

interface AssetIdentity {
    handle: string;
    name: string;
    version: string;
}
const KAPETA_YML_RX = /^kapeta.ya?ml$/;
export class RepositoryWatcher extends EventEmitter {
    private watcher?: FSWatcher;
    private disabled: boolean = false;
    private readonly baseDir: string;
    private allDefinitions: DefinitionInfo[] = [];
    private symbolicLinks: { [link: string]: string } = {};
    private sourceOfChange: Map<string, SourceOfChange> = new Map();
    constructor() {
        super();
        this.baseDir = ClusterConfiguration.getRepositoryBasedir();
    }

    setDisabled(disabled: boolean) {
        this.disabled = disabled;
    }
    public watch() {
        if (!FS.existsSync(this.baseDir)) {
            FS.mkdirpSync(this.baseDir);
        }

        this.allDefinitions = ClusterConfiguration.getDefinitions();

        try {
            this.watcher = chokidar.watch(this.baseDir, {
                followSymlinks: false,
                ignorePermissionErrors: true,
                disableGlobbing: true,
                persistent: true,
                depth: 2,
                ignored: (path) => this.ignoreFile(path),
            });
            this.watcher.on('all', this.handleFileChange.bind(this));
            this.watcher.on('error', (error) => {
                console.log('Error watching repository', error);
            });
            this.watcher.on('ready', () => {
                console.log('Watching local repository for provider changes: %s', this.baseDir);
            });
        } catch (e) {
            // Fallback to run without watch mode due to potential platform issues.
            // https://nodejs.org/docs/latest/api/fs.html#caveats
            console.log('Unable to watch for changes. Changes to assets will not update automatically.', e);
            return;
        }
    }

    async setSourceOfChangeFor(file: string, source: SourceOfChange) {
        this.sourceOfChange.set(file, source);
        try {
            const realPath = await FS.realpath(file);
            if (realPath !== file) {
                this.sourceOfChange.set(realPath, source);
            }
        } catch (e) {
            // Ignore
        }
    }

    async clearSourceOfChangeFor(file: string) {
        this.sourceOfChange.delete(file);
        try {
            const realPath = await FS.realpath(file);
            if (realPath !== file) {
                this.sourceOfChange.delete(realPath);
            }
        } catch (e) {
            // Ignore
        }
    }

    public async unwatch() {
        if (!this.watcher) {
            return;
        }
        this.symbolicLinks = {};
        await this.watcher.close();
        this.watcher = undefined;
    }

    private async getAssetIdentity(path: string): Promise<AssetIdentity | undefined> {
        const baseName = Path.basename(path);
        let handle, name, version;
        if (path.startsWith(this.baseDir)) {
            const relativePath = Path.relative(this.baseDir, path);
            // Inside the repo we can use the path to determine the handle, name and version
            [handle, name, version] = relativePath.split(Path.sep);
            if (!handle || !name || !version) {
                // Do nothing with this
                return;
            }

            return {
                handle,
                name,
                version,
            };
        }

        if (!KAPETA_YML_RX.test(baseName)) {
            // Do nothing with this
            return;
        }
        // Outside the repo we need to use the file content to determine the handle, name
        // Version is always 'local'
        version = 'local';

        try {
            const definition: Definition = YAML.parse((await FS.readFile(path)).toString());
            const uri = parseKapetaUri(definition.metadata.name);
            handle = uri.handle;
            name = uri.name;
            return {
                handle,
                name,
                version,
            };
        } catch (e) {
            // Ignore issues in the YML file
            return;
        }
    }

    private async handleFileChange(eventName: WatchEventName, path: string) {
        if (!path) {
            return;
        }

        const assetIdentity = await this.getAssetIdentity(path);
        if (!assetIdentity) {
            return;
        }

        if (this.disabled) {
            return;
        }

        // If this is false it's because we're watching a symlink target
        const withinRepo = path.startsWith(this.baseDir);
        if (withinRepo && assetIdentity.version === 'local' && path.endsWith(Path.sep + 'local')) {
            // This is likely a symlink target
            if (eventName === 'add') {
                //console.log('Checking if we should add symlink target', handle, name, version, path);
                await this.addSymlinkTarget(path);
            }

            if (eventName === 'unlink') {
                await this.removeSymlinkTarget(path);
            }

            if (eventName === 'change') {
                await this.updateSymlinkTarget(path);
            }
        }

        const sourceOfChange = this.sourceOfChange.get(path) ?? 'filesystem';
        await this.checkForChange(assetIdentity, sourceOfChange);

        // We consume the sourceOfChange when the file is changed
        this.sourceOfChange.delete(path);
    }

    private async checkForChange(assetIdentity: AssetIdentity, sourceOfChange: SourceOfChange) {
        const ymlPath = Path.join(
            this.baseDir,
            assetIdentity.handle,
            assetIdentity.name,
            assetIdentity.version,
            'kapeta.yml'
        );
        const newDefinitions = ClusterConfiguration.getDefinitions();
        const newDefinition = newDefinitions.find((d) => d.ymlPath === ymlPath);
        let currentDefinition = this.allDefinitions.find((d) => d.ymlPath === ymlPath);
        const ymlExists = await this.exists(ymlPath);
        let type;
        if (ymlExists) {
            if (currentDefinition) {
                if (newDefinition && _.isEqual(currentDefinition, newDefinition)) {
                    //Definition was not changed
                    return;
                }
                type = 'updated';
            } else if (newDefinition) {
                type = 'added';
                currentDefinition = newDefinition;
            } else {
                //Other definition was added / updated - ignore
                return;
            }
        } else {
            if (currentDefinition) {
                const ref = parseKapetaUri(
                    `${currentDefinition.definition.metadata.name}:${currentDefinition.version}`
                ).id;
                //Something was removed
                type = 'removed';
            } else {
                //Other definition was removed - ignore
                return;
            }
        }

        const payload = {
            type,
            definition: newDefinition?.definition ?? currentDefinition?.definition,
            asset: assetIdentity,
            sourceOfChange,
        };

        this.allDefinitions = newDefinitions;

        //console.log('Asset changed', payload);
        socketManager.emitGlobal('asset-change', payload);
        this.emit('change', payload);

        cacheManager.flush();
    }

    private async exists(path: string): Promise<boolean> {
        try {
            await FS.access(path);
            return true;
        } catch (e) {
            return false;
        }
    }
    private async removeSymlinkTarget(path: string) {
        if (this.symbolicLinks[path]) {
            //console.log('Unwatching symlink target %s => %s', path, this.symbolicLinks[path]);
            this.watcher?.unwatch(this.symbolicLinks[path]);
            delete this.symbolicLinks[path];
        }
    }

    private async updateSymlinkTarget(path: string) {
        if (this.symbolicLinks[path]) {
            //console.log('Updating symlink target %s => %s', path, this.symbolicLinks[path]);
            this.watcher?.unwatch(this.symbolicLinks[path]);
            delete this.symbolicLinks[path];
            await this.addSymlinkTarget(path);
        }
    }

    private async addSymlinkTarget(path: string) {
        try {
            // Make sure we're not watching the symlink target
            await this.removeSymlinkTarget(path);
            let symbolicLink = false;
            try {
                const stat = await FS.lstat(path);
                symbolicLink = stat.isSymbolicLink();
            } catch (e) {}

            if (symbolicLink) {
                const realPath = Path.join(await FS.realpath(path), 'kapeta.yml');
                if (await this.exists(realPath)) {
                    //console.log('Watching symlink target %s => %s', path, realPath);
                    this.watcher?.add(realPath);
                    this.symbolicLinks[path] = realPath;
                }
            }
        } catch (e) {
            // Ignore
            console.warn('Failed to check local symlink target', e);
        }
    }

    private ignoreFile(path: string) {
        if (!path.startsWith(this.baseDir)) {
            return false;
        }
        if (path.includes(Path.sep + 'node_modules' + Path.sep)) {
            return true;
        }

        const filename = Path.basename(path);
        if (filename.startsWith('.')) {
            return true;
        }

        const relativePath = Path.relative(this.baseDir, path).split(Path.sep);

        try {
            if (FS.statSync(path).isDirectory()) {
                if (relativePath.length > 3) {
                    return true;
                }
                return false;
            }
        } catch (e) {
            // Didn't exist - dont ignore
            return false;
        }

        return !/^kapeta\.ya?ml$/.test(filename);
    }
}
