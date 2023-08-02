import Path from 'path';
import { storageService } from './storageService';
import os from 'os';
import _ from 'lodash';
import FSExtra, { ReadStream } from 'fs-extra';
import { Docker } from 'node-docker-api';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { Container } from 'node-docker-api/lib/container';
import uuid from 'node-uuid';
import md5 from 'md5';
import { getBlockInstanceContainerName } from './utils/utils';
import { InstanceInfo, LogEntry, LogSource } from './types';
import { socketManager } from './socketManager';
import { handlers as ArtifactHandlers } from '@kapeta/nodejs-registry-utils';
import { progressListener } from './progressListener';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

const EVENT_IMAGE_PULL = 'docker-image-pull';

type StringMap = { [key: string]: string };

export type PortMap = {
    [key: string]: {
        containerPort: string;
        protocol: string;
        hostPort: string;
    };
};

export interface DockerMounts {
    Target: string;
    Source: string;
    Type: string;
    ReadOnly: boolean;
    Consistency: string;
}

interface DockerState {
    Status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    Dead: boolean;
    Pid: number;
    ExitCode: number;
    Error: string;
    StartedAt: string;
    FinishedAt: string;
    Health?: {
        Status: 'starting' | 'healthy' | 'unhealthy' | 'none';
        FailingStreak: number;
        Log: any[] | null;
    };
}

interface Health {
    cmd: string;
    interval?: number;
    timeout?: number;
    retries?: number;
}

export const CONTAINER_LABEL_PORT_PREFIX = 'kapeta_port-';
const NANO_SECOND = 1000000;
const HEALTH_CHECK_INTERVAL = 3000;
const HEALTH_CHECK_MAX = 20;


export const HEALTH_CHECK_TIMEOUT = HEALTH_CHECK_INTERVAL * HEALTH_CHECK_MAX * 2;

const promisifyStream = (stream: ReadStream, handler: (d: string | Buffer) => void) =>
    new Promise((resolve, reject) => {
        stream.on('data', handler);
        stream.on('end', resolve);
        stream.on('error', reject);
    });

class ContainerManager {
    private _docker: Docker | null;
    private _alive: boolean;
    private _mountDir: string;
    private _version: string;
    private _lastDockerAccessCheck: number = 0;

    constructor() {
        this._docker = null;
        this._alive = false;
        this._version = '';
        this._mountDir = Path.join(storageService.getKapetaBasedir(), 'mounts');
        FSExtra.mkdirpSync(this._mountDir);
    }

    async initialize() {
        // Use the value from cluster-service.yml if configured
        const dockerConfig = ClusterConfiguration.getDockerConfig();
        const connectOptions =
            Object.keys(dockerConfig).length > 0
                ? [dockerConfig]
                : [
                      // use defaults: DOCKER_HOST etc from env, if available
                      undefined,
                      // default linux
                      { socketPath: '/var/run/docker.sock' },
                      // default macOS
                      {
                          socketPath: Path.join(os.homedir(), '.docker/run/docker.sock'),
                      },
                      // Default http
                      { protocol: 'http', host: 'localhost', port: 2375 },
                      { protocol: 'https', host: 'localhost', port: 2376 },
                      { protocol: 'http', host: '127.0.0.1', port: 2375 },
                      { protocol: 'https', host: '127.0.0.1', port: 2376 },
                  ];
        for (const opts of connectOptions) {
            try {
                const client = new Docker(opts);
                await client.ping();
                this._docker = client;
                const versionInfo: any = await client.version();
                this._version = versionInfo.Server?.Version ?? versionInfo.Version;
                if (!this._version) {
                    console.warn('Failed to determine version from response', versionInfo);
                    this._version = '0.0.0';
                }
                this._alive = true;
                console.log('Connected to docker daemon with version: %s', this._version);
                return;
            } catch (err) {
                // silently ignore bad configs
            }
        }

        throw new Error('Could not connect to docker daemon. Please make sure docker is running and working.');
    }

    async checkAlive() {
        if (!this._docker) {
            try {
                await this.initialize();
            } catch (e) {
                this._alive = false;
            }
            return this._alive;
        }

        try {
            await this._docker.ping();
            this._alive = true;
        } catch (e) {
            this._alive = false;
        }

        return this._alive;
    }

    isAlive() {
        return this._alive;
    }

    getMountPoint(systemId: string, ref: string, mountName: string) {
        const kindUri = parseKapetaUri(ref);
        const systemUri = parseKapetaUri(systemId);
        return Path.join(
            this._mountDir,
            systemUri.handle,
            systemUri.name,
            systemUri.version,
            kindUri.handle,
            kindUri.name,
            kindUri.version,
            mountName
        );
    }

    async createMounts(systemId: string, kind: string, mountOpts: StringMap | null | undefined): Promise<StringMap> {
        const mounts: StringMap = {};

        if (mountOpts) {
            const mountOptList = Object.entries(mountOpts);
            for (const [mountName, containerPath] of mountOptList) {
                const hostPath = this.getMountPoint(systemId, kind, mountName);
                await FSExtra.mkdirp(hostPath);
                mounts[containerPath] = hostPath;
            }
        }

        return mounts;
    }

    async ping() {
        try {
            const pingResult = await this.docker().ping();
            if (pingResult !== 'OK') {
                throw new Error(`Ping failed: ${pingResult}`);
            }
        } catch (e: any) {
            throw new Error(
                `Docker not running. Please start the docker daemon before running this command. Error: ${e.message}`
            );
        }
    }

    docker() {
        if (!this._docker) {
            throw new Error(`Docker not running`);
        }
        return this._docker;
    }

    async getContainerByName(containerName: string): Promise<ContainerInfo | undefined> {
        const containers = await this.docker().container.list({ all: true });
        const out = containers.find((container) => {
            const containerData = container.data as any;
            return containerData.Names.indexOf(`/${containerName}`) > -1;
        });

        if (out) {
            return new ContainerInfo(out);
        }
        return undefined;
    }

    async pull(image: string) {
        let [imageName, tag] = image.split(/:/);
        if (!tag) {
            tag = 'latest';
        }

        const imageTagList = (await this.docker().image.list())
            .map((image) => image.data as any)
            .filter((imageData) => !!imageData.RepoTags)
            .map((imageData) => imageData.RepoTags as string[]);

        if (imageTagList.some((imageTags) => imageTags.indexOf(image) > -1)) {
            console.log('Image found: %s', image);
            return false;
        }

        const timeStarted = Date.now();
        socketManager.emitGlobal(EVENT_IMAGE_PULL, { image, percent: -1 });

        const api = new KapetaAPI();
        const accessToken = await api.getAccessToken();

        const auth = image.startsWith('docker.kapeta.com/')
            ? {
                  username: 'kapeta',
                  password: accessToken,
                  serveraddress: 'docker.kapeta.com',
              }
            : {};

        const stream = (await this.docker().image.create(auth, {
            fromImage: imageName,
            tag: tag,
        })) as ReadStream;

        const chunks: {
            [p: string]: {
                downloading: {
                    total: number;
                    current: number;
                };
                extracting: {
                    total: number;
                    current: number;
                };
                done: boolean;
            };
        } = {};

        let lastEmitted = Date.now();
        await promisifyStream(stream, (rawData) => {
            const lines = rawData.toString().trim().split('\n');
            lines.forEach((line) => {
                const data = JSON.parse(line);
                if (
                    ![
                        'Waiting',
                        'Downloading',
                        'Extracting',
                        'Download complete',
                        'Pull complete',
                        'Already exists',
                    ].includes(data.status)
                ) {
                    return;
                }

                if (!chunks[data.id]) {
                    chunks[data.id] = {
                        downloading: {
                            total: 0,
                            current: 0,
                        },
                        extracting: {
                            total: 0,
                            current: 0,
                        },
                        done: false,
                    };
                }

                const chunk = chunks[data.id];

                switch (data.status) {
                    case 'Downloading':
                        chunk.downloading = data.progressDetail;
                        break;
                    case 'Extracting':
                        chunk.extracting = data.progressDetail;
                        break;
                    case 'Download complete':
                        chunk.downloading.current = chunks[data.id].downloading.total;
                        break;
                    case 'Pull complete':
                        chunk.extracting.current = chunks[data.id].extracting.total;
                        chunk.done = true;
                        break;
                    case 'Already exists':
                        // Force layer to be done
                        chunk.downloading.current = 1;
                        chunk.downloading.total = 1;
                        chunk.extracting.current = 1;
                        chunk.extracting.total = 1;
                        chunk.done = true;
                        break;
                }
            });

            if (Date.now() - lastEmitted < 1000) {
                return;
            }

            const chunkList = Object.values(chunks);
            let totals = {
                downloading: {
                    total: 0,
                    current: 0,
                },
                extracting: {
                    total: 0,
                    current: 0,
                },
                total: chunkList.length,
                done: 0,
            };

            chunkList.forEach((chunk) => {
                if (chunk.downloading.current > 0) {
                    totals.downloading.current += chunk.downloading.current;
                }

                if (chunk.downloading.total > 0) {
                    totals.downloading.total += chunk.downloading.total;
                }

                if (chunk.extracting.current > 0) {
                    totals.extracting.current += chunk.extracting.current;
                }

                if (chunk.extracting.total > 0) {
                    totals.extracting.total += chunk.extracting.total;
                }

                if (chunk.done) {
                    totals.done++;
                }
            });

            const percent = totals.total > 0 ? (totals.done / totals.total) * 100 : 0;
            //We emit at most every second to not spam the client
            socketManager.emitGlobal(EVENT_IMAGE_PULL, {
                image,
                percent,
                status: totals,
                timeTaken: Date.now() - timeStarted,
            });
            lastEmitted = Date.now();
            //console.log('Pulling image %s: %s % [done: %s, total: %s]', image, Math.round(percent), totals.done, totals.total);
        });

        socketManager.emitGlobal(EVENT_IMAGE_PULL, { image, percent: 100, timeTaken: Date.now() - timeStarted });

        return true;
    }

    toDockerMounts(mounts: StringMap) {
        const Mounts: DockerMounts[] = [];
        _.forEach(mounts, (Source, Target) => {
            Mounts.push({
                Target,
                Source: toLocalBindVolume(Source),
                Type: 'bind',
                ReadOnly: false,
                Consistency: 'consistent',
            });
        });

        return Mounts;
    }

    toDockerHealth(health: Health) {
        return {
            Test: ['CMD-SHELL', health.cmd],
            Interval: health.interval ? health.interval * NANO_SECOND : 5000 * NANO_SECOND,
            Timeout: health.timeout ? health.timeout * NANO_SECOND : 15000 * NANO_SECOND,
            Retries: health.retries || 10,
        };
    }

    private applyHash(dockerOpts: any) {
        if (dockerOpts?.Labels?.HASH) {
            delete dockerOpts.Labels.HASH;
        }

        const hash = md5(JSON.stringify(dockerOpts));

        if (!dockerOpts.Labels) {
            dockerOpts.Labels = {};
        }
        dockerOpts.Labels.HASH = hash;
    }

    public async ensureContainer(opts: any) {
        return await this.createOrUpdateContainer(opts);
    }

    private async createOrUpdateContainer(opts: any) {
        let imagePulled = await this.pull(opts.Image);

        this.applyHash(opts);
        if (!opts.name) {
            console.log('Starting unnamed container: %s', opts.Image);
            return this.startContainer(opts);
        }
        const containerInfo = await this.getContainerByName(opts.name);
        if (imagePulled) {
            console.log('New version of image was pulled: %s', opts.Image);
        } else {
            // If image was pulled always recreate
            if (!containerInfo) {
                console.log('Starting new container: %s', opts.name);
                return this.startContainer(opts);
            }

            const containerData = containerInfo.native.data as any;

            if (containerData?.Labels?.HASH === opts.Labels.HASH) {
                if (!(await containerInfo.isRunning())) {
                    console.log('Starting previously created container: %s', opts.name);
                    await containerInfo.start();
                } else {
                    console.log('Previously created container already running: %s', opts.name);
                }
                return containerInfo.native;
            }
        }

        if (containerInfo) {
            // Remove the container and start a new one
            console.log('Replacing previously created container: %s', opts.name);
            await containerInfo.remove({ force: true });
        }

        console.log('Starting new container: %s', opts.name);
        return this.startContainer(opts);
    }

    async startContainer(opts: any) {
        const extraHosts = getExtraHosts(this._version);

        if (extraHosts && extraHosts.length > 0) {
            if (!opts.HostConfig) {
                opts.HostConfig = {};
            }

            if (!opts.HostConfig.ExtraHosts) {
                opts.HostConfig.ExtraHosts = [];
            }

            opts.HostConfig.ExtraHosts = opts.HostConfig.ExtraHosts.concat(extraHosts);
        }

        const dockerContainer = await this.docker().container.create(opts);
        await dockerContainer.start();
        return dockerContainer;
    }

    async waitForReady(container: Container, attempt: number = 0): Promise<void> {
        if (!attempt) {
            attempt = 0;
        }

        if (attempt >= HEALTH_CHECK_MAX) {
            throw new Error('Container did not become ready within the timeout');
        }

        if (await this._isReady(container)) {
            return;
        }

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    await this.waitForReady(container, attempt + 1);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, HEALTH_CHECK_INTERVAL);
        });
    }

    async _isReady(container: Container) {
        let info: Container;
        try {
            info = await container.status();
        } catch (err) {
            return false;
        }
        const infoData: any = info?.data;
        const state = infoData?.State as DockerState;

        if (state?.Status === 'exited' || state?.Status === 'removing' || state?.Status === 'dead') {
            throw new Error('Container exited unexpectedly');
        }

        if (infoData?.State?.Health) {
            // If container has health info - wait for it to become healthy
            return infoData.State.Health.Status === 'healthy';
        } else {
            return infoData?.State?.Running ?? false;
        }
    }

    async remove(container: Container, opts?: { force?: boolean }) {
        const newName = 'deleting-' + uuid.v4();
        const containerData = container.data as any;
        // Rename the container first to avoid name conflicts if people start the same container
        await container.rename({ name: newName });
        await container.delete({ force: !!opts?.force });
    }

    /**
     *
     * @param name
     * @return {Promise<ContainerInfo>}
     */
    async get(name: string): Promise<ContainerInfo | null> {
        let dockerContainer = null;

        try {
            dockerContainer = await this.docker().container.get(name);
            await dockerContainer.status();
        } catch (err) {
            //Ignore
            dockerContainer = null;
        }

        if (!dockerContainer) {
            return null;
        }

        return new ContainerInfo(dockerContainer);
    }

    async getLogs(instance: InstanceInfo): Promise<LogEntry[]> {
        const containerName = getBlockInstanceContainerName(instance.systemId, instance.instanceId);
        const containerInfo = await this.getContainerByName(containerName);
        if (!containerInfo) {
            return [
                {
                    source: 'stdout',
                    level: 'ERROR',
                    time: Date.now(),
                    message: 'Container not found',
                },
            ];
        }

        return containerInfo.getLogs();
    }
}

export class ContainerInfo {
    private readonly _container: Container;

    /**
     *
     * @param {Container} dockerContainer
     */
    constructor(dockerContainer: Container) {
        /**
         *
         * @type {Container}
         * @private
         */
        this._container = dockerContainer;
    }

    get native() {
        return this._container;
    }

    async isRunning() {
        const inspectResult = await this.inspect();

        if (!inspectResult || !inspectResult.State) {
            return false;
        }

        return inspectResult.State.Running || inspectResult.State.Restarting;
    }

    async start() {
        await this._container.start();
    }

    async restart() {
        await this._container.restart();
    }

    async stop() {
        await this._container.stop();
    }

    async remove(opts?: { force?: boolean }) {
        await containerManager.remove(this._container, opts);
    }

    async getPort(type: string) {
        const ports = await this.getPorts();

        if (ports && ports[type]) {
            return ports[type];
        }

        return null;
    }

    async inspect() {
        try {
            const result = await this._container.status();

            return result ? (result.data as any) : null;
        } catch (err) {
            return null;
        }
    }

    async status() {
        const result = await this.inspect();

        return result.State as DockerState;
    }

    async getPorts(): Promise<PortMap | false> {
        const inspectResult = await this.inspect();

        if (!inspectResult || !inspectResult.Config || !inspectResult.Config.Labels) {
            return false;
        }

        const portTypes: StringMap = {};
        const ports: PortMap = {};

        _.forEach(inspectResult.Config.Labels, (portType, name) => {
            if (!name.startsWith(CONTAINER_LABEL_PORT_PREFIX)) {
                return;
            }

            const hostPort = name.substr(CONTAINER_LABEL_PORT_PREFIX.length);

            portTypes[hostPort] = portType;
        });

        _.forEach(inspectResult.HostConfig.PortBindings, (portBindings, containerPortSpec) => {
            let [containerPort, protocol] = containerPortSpec.split(/\//);

            const hostPort = portBindings[0].HostPort;

            const portType = portTypes[hostPort];

            ports[portType] = {
                containerPort,
                protocol,
                hostPort,
            };
        });

        return ports;
    }

    async getLogs(): Promise<LogEntry[]> {
        const logStream = (await this.native.logs({
            stdout: true,
            stderr: true,
            follow: false,
            tail: 100,
            timestamps: true,
        })) as ReadStream;

        const out = [] as LogEntry[];
        await promisifyStream(logStream, (data) => {
            const buf = data as Buffer;
            let offset = 0;
            while (offset < buf.length) {
                try {
                    // Read the docker log format - explained here:
                    // https://docs.docker.com/engine/api/v1.41/#operation/ContainerAttach
                    // or here : https://ahmet.im/blog/docker-logs-api-binary-format-explained/

                    // First byte is stream type
                    const streamTypeInt = buf.readInt8(offset);
                    const streamType: LogSource = streamTypeInt === 1 ? 'stdout' : 'stderr';

                    // Bytes 4-8 is frame size
                    const messageLength = buf.readInt32BE(offset + 4);

                    // After that is the message - with the message length
                    const dataWithoutStreamType = buf.subarray(offset + 8, offset + 8 + messageLength);
                    const raw = dataWithoutStreamType.toString();

                    // Split the message into date and message
                    const firstSpaceIx = raw.indexOf(' ');
                    const dateString = raw.substring(0, firstSpaceIx);
                    const line = raw.substring(firstSpaceIx + 1);
                    offset = offset + messageLength + 8;
                    if (!dateString) {
                        continue;
                    }
                    out.push({
                        time: new Date(dateString).getTime(),
                        message: line,
                        level: 'INFO',
                        source: streamType,
                    });
                } catch (err) {
                    console.error('Error parsing log entry', err);
                    offset = buf.length;
                }
            }
        });

        if (out.length === 0) {
            out.push({
                time: Date.now(),
                message: 'No logs found for container',
                level: 'INFO',
                source: 'stdout',
            });
        }

        return out;
    }
}

export function getExtraHosts(dockerVersion: string): string[] | undefined {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        const [major, minor] = dockerVersion.split('.');
        if (parseInt(major) >= 20 && parseInt(minor) >= 10) {
            // Docker 20.10+ on Linux supports adding host.docker.internal to point to host-gateway
            return ['host.docker.internal:host-gateway'];
        }
        // Docker versions lower than 20.10 needs an actual IP address. We use the default network bridge which
        // is always 172.17.0.1
        return ['host.docker.internal:172.17.0.1'];
    }

    return undefined;
}

/**
 * Ensure that the volume is in the correct format for the docker daemon on the host
 *
 * Windows: c:\path\to\volume -> /c/path/to/volume
 * Linux: /path/to/volume -> /path/to/volume
 * Mac: /path/to/volume -> /path/to/volume
 */
export function toLocalBindVolume(volume: string): string {
    if (process.platform === 'win32') {
        //On Windows we need to convert c:\ to /c/
        return volume
            .replace(/^([a-z]):\\/i, (match, drive) => {
                return '/' + drive.toLowerCase() + '/';
            })
            .replace(/\\(\S)/g, '/$1');
    }
    return volume;
}

export const containerManager = new ContainerManager();
