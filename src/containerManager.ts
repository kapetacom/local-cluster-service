/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Path from 'path';
import { storageService } from './storageService';
import os from 'os';
import _ from 'lodash';
import FSExtra, { ReadStream } from 'fs-extra';
import Docker from 'dockerode';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import uuid from 'node-uuid';
import md5 from 'md5';
import { getBlockInstanceContainerName } from './utils/utils';
import { DOCKER_HOST_INTERNAL, InstanceInfo, LogEntry, LogSource } from './types';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { taskManager, Task } from './taskManager';
import { EventEmitter } from 'node:events';
import StreamValues from 'stream-json/streamers/StreamValues';
import { LocalInstanceHealth } from '@kapeta/schemas';

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
    Labels?: StringMap;
}

interface JSONProgress {
    // Current is the current status and value of the progress made towards Total.
    current: number;
    // Total is the end value describing when we made 100% progress for an operation.
    total: number;
    // Start is the initial value for the operation.
    start: number;
    // HideCounts. if true, hides the progress count indicator (xB/yB).
    hidecounts: boolean;
    // Units is the unit to print for progress. It defaults to "bytes" if empty.
    units: string;
}

interface JSONError {
    code: number;
    message: string;
}

export type DockerContainerStatus = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
export type DockerContainerHealth = 'starting' | 'healthy' | 'unhealthy' | 'none';

interface JSONMessage<T = string> {
    stream?: string;
    status: T;
    progressDetail?: JSONProgress;
    progress?: string;
    id: string;
    from: string;
    time: number;
    timeNano: number;
    errorDetail?: JSONError;
    error?: string;
    // Aux contains out-of-band data, such as digests for push signing and image id after building.
    aux?: any;
}

export const CONTAINER_LABEL_PORT_PREFIX = 'kapeta_port-';
const NANO_SECOND = 1000000;
const HEALTH_CHECK_INTERVAL = 3000;
const HEALTH_CHECK_MAX = 100;
const LATEST_PULL_TIMEOUT = 1000 * 60 * 15; // 15 minutes
export const COMPOSE_LABEL_PROJECT = 'com.docker.compose.project';
export const COMPOSE_LABEL_SERVICE = 'com.docker.compose.service';

export const HEALTH_CHECK_TIMEOUT = HEALTH_CHECK_INTERVAL * HEALTH_CHECK_MAX * 2;

enum DockerPullEventTypes {
    PreparingPhase = 'Preparing',
    WaitingPhase = 'Waiting',
    PullingFsPhase = 'Pulling fs layer',
    DownloadingPhase = 'Downloading',
    DownloadCompletePhase = 'Download complete',
    ExtractingPhase = 'Extracting',
    VerifyingChecksumPhase = 'Verifying Checksum',
    AlreadyExistsPhase = 'Already exists',
    PullCompletePhase = 'Pull complete',
}

type DockerPullEventType = DockerPullEventTypes | string;

const processJsonStream = <T>(purpose: string, stream: NodeJS.ReadableStream, handler: (d: JSONMessage<T>) => void) =>
    new Promise<void>((resolve, reject) => {
        const jsonStream = StreamValues.withParser();
        jsonStream.on('data', (data: any) => {
            try {
                handler(data.value as JSONMessage<T>);
            } catch (e) {
                console.error('Failed while processing data for stream: %s', purpose, e);
            }
        });
        jsonStream.on('end', () => {
            console.log('Docker stream ended: %s', purpose);
            resolve();
        });
        jsonStream.on('error', (err) => {
            console.error('Docker stream failed: %s', purpose, err);
            reject(err);
        });

        stream.pipe(jsonStream);
    });

class ContainerManager {
    private _docker: Docker | null;
    private _alive: boolean;
    private _mountDir: string;
    private _version: string;
    private _lastDockerAccessCheck: number = 0;
    private logStreams: { [p: string]: { stream?: ClosableLogStream; timer?: NodeJS.Timeout } } = {};
    private _latestImagePulls: { [p: string]: number } = {};

    constructor() {
        this._docker = null;
        this._alive = false;
        this._version = '';
        this._mountDir = Path.join(storageService.getKapetaBasedir(), 'mounts');
        this._latestImagePulls = {};
        FSExtra.mkdirpSync(this._mountDir);
    }

    async initialize() {
        // Use the value from cluster-service.yml if configured
        const dockerConfig = ClusterConfiguration.getDockerConfig();
        const connectOptions: any[] =
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
                const testClient = new Docker({
                    ...opts,
                    timeout: 1000, // 1 secs should be enough for a ping
                });
                await testClient.ping();
                // If we get here - we have a working connection
                // Now create a client with a longer timeout for all other operations
                const client = new Docker({
                    ...opts,
                    timeout: 15 * 60 * 1000, //15 minutes should be enough for any operation
                });
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

    async createVolumes(
        systemId: string,
        serviceId: string,
        mountOpts: StringMap | null | undefined
    ): Promise<DockerMounts[]> {
        const Mounts: DockerMounts[] = [];

        if (mountOpts) {
            const mountOptList = Object.entries(mountOpts);
            for (const [mountName, containerPath] of mountOptList) {
                const volumeName = `${systemId}_${serviceId}_${mountName}`.replace(/[^a-z0-9]/gi, '_');

                Mounts.push({
                    Target: containerPath,
                    Source: volumeName,
                    Type: 'volume',
                    ReadOnly: false,
                    Consistency: 'consistent',
                    Labels: {
                        [COMPOSE_LABEL_PROJECT]: systemId.replace(/[^a-z0-9]/gi, '_'),
                        [COMPOSE_LABEL_SERVICE]: serviceId.replace(/[^a-z0-9]/gi, '_'),
                    },
                });
            }
        }

        return Mounts;
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
        // The container can be fetched by name or by id using the same API call
        return this.get(containerName);
    }

    async pull(image: string) {
        let [imageName, tag] = image.split(/:/);
        if (!tag) {
            tag = 'latest';
        }

        if (tag === 'local') {
            // Local image - no need to pull
            return false;
        }

        const imageTagList = (await this.docker().listImages({}))
            .filter((imageData) => !!imageData.RepoTags)
            .map((imageData) => imageData.RepoTags as string[]);

        const imageExists = imageTagList.some((imageTags) => imageTags.includes(image));

        if (tag === 'latest') {
            if (imageExists && this._latestImagePulls[imageName]) {
                const lastPull = this._latestImagePulls[imageName];
                const timeSinceLastPull = Date.now() - lastPull;
                if (timeSinceLastPull < LATEST_PULL_TIMEOUT) {
                    console.log(
                        'Image found and was pulled %s seconds ago: %s',
                        Math.round(timeSinceLastPull / 1000),
                        image
                    );
                    // Last pull was less than the timeout - don't pull again
                    return false;
                }
            }
            this._latestImagePulls[imageName] = Date.now();
        } else if (imageExists) {
            console.log('Image found: %s', image);
            return false;
        }

        let friendlyImageName = image;
        const imageParts = imageName.split('/');
        if (imageParts.length > 2) {
            //Strip the registry to make the name shorter
            friendlyImageName = `${imageParts.slice(1).join('/')}:${tag}`;
        }

        const taskName = `Pulling image ${friendlyImageName}`;

        const processor = async (task: Task) => {
            const timeStarted = Date.now();
            const api = new KapetaAPI();
            const accessToken = api.hasToken() ? await api.getAccessToken() : null;

            const auth =
                accessToken && image.startsWith('docker.kapeta.com/')
                    ? {
                          username: 'kapeta',
                          password: accessToken,
                          serveraddress: 'docker.kapeta.com',
                      }
                    : {};

            const stream = await this.docker().pull(image, {
                authconfig: auth,
            });

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
            await processJsonStream<DockerPullEventType>(`image:pull:${image}`, stream, (data) => {
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

                if (data.stream) {
                    // Emit raw output to the task log
                    task.addLog(data.stream);
                }

                switch (data.status) {
                    case DockerPullEventTypes.PreparingPhase:
                    case DockerPullEventTypes.WaitingPhase:
                    case DockerPullEventTypes.PullingFsPhase:
                        //Do nothing
                        break;
                    case DockerPullEventTypes.DownloadingPhase:
                    case DockerPullEventTypes.VerifyingChecksumPhase:
                        chunk.downloading = {
                            total: data.progressDetail?.total ?? 0,
                            current: data.progressDetail?.current ?? 0,
                        };
                        break;
                    case DockerPullEventTypes.ExtractingPhase:
                        chunk.extracting = {
                            total: data.progressDetail?.total ?? 0,
                            current: data.progressDetail?.current ?? 0,
                        };
                        break;
                    case DockerPullEventTypes.DownloadCompletePhase:
                        chunk.downloading.current = chunks[data.id].downloading.total;
                        break;
                    case DockerPullEventTypes.PullCompletePhase:
                        chunk.extracting.current = chunks[data.id].extracting.total;
                        chunk.done = true;
                        break;
                }

                if (
                    data.status === DockerPullEventTypes.AlreadyExistsPhase ||
                    data.status.includes('Image is up to date') ||
                    data.status.includes('Downloaded newer image')
                ) {
                    chunk.downloading.current = 1;
                    chunk.downloading.total = 1;
                    chunk.extracting.current = 1;
                    chunk.extracting.total = 1;
                    chunk.done = true;
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
                    percent: 0,
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

                totals.percent = totals.total > 0 ? (totals.done / totals.total) * 100 : 0;

                task.metadata = {
                    ...task.metadata,
                    image,
                    progress: totals.percent,
                    status: totals,
                    timeTaken: Date.now() - timeStarted,
                };

                if (Date.now() - lastEmitted < 1000) {
                    return;
                }
                task.emitUpdate();
                lastEmitted = Date.now();
                //console.log('Pulling image %s: %s % [done: %s, total: %s]', image, Math.round(percent), totals.done, totals.total);
            });

            task.metadata = {
                ...task.metadata,
                image,
                progress: 100,
                timeTaken: Date.now() - timeStarted,
            };
            task.emitUpdate();
        };

        const task = taskManager.add(`docker:image:pull:${image}`, processor, {
            name: taskName,
            image,
            progress: -1,
            group: 'docker:pull', //It's faster to pull images one at a time
        });

        await task.wait();

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

    toDockerHealth(health: LocalInstanceHealth) {
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
        const container = await this.getContainerByName(opts.name);
        if (imagePulled) {
            // If image was pulled always recreate
            console.log('New version of image was pulled: %s', opts.Image);
        } else {
            if (!container) {
                console.log('Starting new container: %s', opts.name);
                return this.startContainer(opts);
            }

            const containerData = await container.inspect();

            if (containerData?.Config.Labels?.HASH === opts.Labels.HASH) {
                if (!(await container.isRunning())) {
                    console.log('Starting previously created container: %s', opts.name);
                    await container.start();
                } else {
                    console.log('Previously created container already running: %s', opts.name);
                }
                return container.native;
            }
        }

        if (container) {
            // Remove the container and start a new one
            console.log('Replacing previously created container: %s', opts.name);
            await container.remove({ force: true });
        }

        console.log('Starting new container: %s', opts.name);
        return this.startContainer(opts);
    }

    private async startContainer(opts: any) {
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

        const dockerContainer = await this.docker().createContainer(opts);
        await dockerContainer.start();
        return dockerContainer;
    }

    async waitForReady(container: Docker.Container, attempt: number = 0): Promise<void> {
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

    async _isReady(container: Docker.Container) {
        let info: Docker.ContainerInspectInfo;
        try {
            info = await container.inspect();
        } catch (err) {
            return false;
        }

        const state = info.State;

        if (state.Status === 'exited' || state?.Status === 'removing' || state?.Status === 'dead') {
            throw new Error('Container exited unexpectedly');
        }

        if (state.Health) {
            // If container has health info - wait for it to become healthy
            return state.Health.Status === 'healthy';
        } else {
            return state.Running ?? false;
        }
    }

    async remove(container: Docker.Container, opts?: { force?: boolean }) {
        const newName = 'deleting-' + uuid.v4();
        // Rename the container first to avoid name conflicts if people start the same container
        await container.rename({ name: newName });

        const newContainer = this.docker().getContainer(newName);
        await newContainer.remove({ force: !!opts?.force });
    }

    /**
     *
     * @param name
     * @return {Promise<ContainerInfo>}
     */
    async get(name: string): Promise<ContainerInfo | undefined> {
        let dockerContainer = null;

        try {
            dockerContainer = this.docker().getContainer(name);
            await dockerContainer.stats();
        } catch (err) {
            //Ignore
            dockerContainer = null;
        }

        if (!dockerContainer) {
            return undefined;
        }

        return new ContainerInfo(dockerContainer);
    }

    async getLogs(instance: InstanceInfo): Promise<LogEntry[]> {
        const containerName = await getBlockInstanceContainerName(instance.systemId, instance.instanceId);
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

        return await containerInfo.getLogs();
    }

    async stopLogListening(systemId: string, instanceId: string) {
        const containerName = await getBlockInstanceContainerName(systemId, instanceId);
        if (this.logStreams[containerName]) {
            if (this.logStreams[containerName]?.timer) {
                clearTimeout(this.logStreams[containerName].timer);
            }
            try {
                const stream = this.logStreams[containerName].stream;
                if (stream) {
                    await stream.close();
                }
            } catch (err) {
                // Ignore
            }
            delete this.logStreams[containerName];
        }
    }

    async ensureLogListening(systemId: string, instanceId: string, handler: (log: LogEntry) => void) {
        const containerName = await getBlockInstanceContainerName(systemId, instanceId);
        try {
            if (this.logStreams[containerName]?.stream) {
                // Already listening - will shut itself down
                return;
            }

            if (this.logStreams[containerName]?.timer) {
                clearTimeout(this.logStreams[containerName].timer);
            }

            const tryLater = () => {
                this.logStreams[containerName] = {
                    timer: setTimeout(() => {
                        // Keep trying until user decides to not listen anymore
                        this.ensureLogListening(systemId, instanceId, handler);
                    }, 5000),
                };
            };

            const containerInfo = await this.getContainerByName(containerName);
            if (!containerInfo || !(await containerInfo.isRunning())) {
                // Container not currently running - try again in 5 seconds
                tryLater();
                return;
            }

            const stream = await containerInfo.getLogStream();
            stream.onLog((log) => {
                try {
                    handler(log);
                } catch (err) {
                    console.warn('Error handling log', err);
                }
            });
            stream.onEnd(() => {
                // We get here if the container is stopped
                delete this.logStreams[containerName];
                tryLater();
            });
            stream.onError((err) => {
                // We get here if the container crashes
                delete this.logStreams[containerName];
                tryLater();
            });

            this.logStreams[containerName] = {
                stream,
            };
        } catch (err) {
            // Ignore
        }
    }

    buildDockerImage(dockerFile: string, imageName: string) {
        const taskName = `Building docker image: ${imageName}`;
        const processor = async (task: Task) => {
            const baseDir = Path.dirname(dockerFile);
            const entries = await FSExtra.readdir(baseDir);
            const contextInfo = {
                context: Path.dirname(dockerFile),
                src: entries,
            };

            const stream = await this.docker().buildImage(contextInfo, {
                t: imageName,
                dockerfile: Path.basename(dockerFile),
            });

            await processJsonStream<string>(`image:build:${imageName}`, stream, (data) => {
                if (data.error) {
                    task.future.reject(new Error(data.error));
                    task.addLog(data.error, 'ERROR');
                } else if (data.stream) {
                    // Emit raw output to the task log
                    task.addLog(data.stream);
                }
            });
        };

        return taskManager.add(`docker:image:build:${imageName}`, processor, {
            name: taskName,
        });
    }
}

function readLogBuffer(logBuffer: Buffer) {
    const out: LogEntry[] = [];
    let offset = 0;
    while (offset < logBuffer.length) {
        try {
            // Read the docker log format - explained here:
            // https://docs.docker.com/engine/api/v1.41/#operation/ContainerAttach
            // or here : https://ahmet.im/blog/docker-logs-api-binary-format-explained/

            // First byte is stream type
            const streamTypeInt = logBuffer.readInt8(offset);
            const streamType: LogSource = streamTypeInt === 1 ? 'stdout' : 'stderr';
            if (streamTypeInt !== 1 && streamTypeInt !== 2) {
                console.error('Unknown stream type: %s', streamTypeInt, out[out.length - 1]);
                break;
            }

            // Bytes 4-8 is frame size
            const messageLength = logBuffer.readInt32BE(offset + 4);

            // After that is the message - with the message length
            const dataWithoutStreamType = logBuffer.subarray(offset + 8, offset + 8 + messageLength);
            const raw = dataWithoutStreamType.toString();

            // Split the message into date and message
            const firstSpaceIx = raw.indexOf(' ');
            const dateString = raw.substring(0, firstSpaceIx);
            const line = raw.substring(firstSpaceIx + 1);
            offset = offset + messageLength + 8;
            if (!dateString) {
                break;
            }
            out.push({
                time: new Date(dateString).getTime(),
                message: line,
                level: 'INFO',
                source: streamType,
            });
        } catch (err) {
            console.error('Error parsing log entry', err);
            offset = logBuffer.length;
            break;
        }
    }
    return out;
}

class ClosableLogStream {
    private readonly stream: FSExtra.ReadStream;

    private readonly eventEmitter: EventEmitter;

    constructor(stream: FSExtra.ReadStream) {
        this.stream = stream;
        this.eventEmitter = new EventEmitter();
        stream.on('data', (data) => {
            const logs = readLogBuffer(data as Buffer);
            logs.forEach((log) => {
                this.eventEmitter.emit('log', log);
            });
        });

        stream.on('end', () => {
            this.eventEmitter.emit('end');
        });

        stream.on('error', (error) => {
            this.eventEmitter.emit('error', error);
        });

        stream.on('close', () => {
            this.eventEmitter.emit('end');
        });
    }

    onLog(listener: (log: LogEntry) => void) {
        this.eventEmitter.on('log', listener);
        return () => {
            this.eventEmitter.removeListener('log', listener);
        };
    }

    onEnd(listener: () => void) {
        this.eventEmitter.on('end', listener);
        return () => {
            this.eventEmitter.removeListener('end', listener);
        };
    }

    onError(listener: (error: Error) => void) {
        this.eventEmitter.on('error', listener);
        return () => {
            this.eventEmitter.removeListener('error', listener);
        };
    }

    close() {
        return new Promise<void>((resolve, reject) => {
            try {
                this.stream.close((err) => {
                    if (err) {
                        console.warn('Error closing log stream', err);
                    }
                    resolve();
                });
            } catch (err) {
                // Ignore
            }
        });
    }
}

export class ContainerInfo {
    private readonly _container: Docker.Container;

    /**
     *
     * @param {Docker.Container} dockerContainer
     */
    constructor(dockerContainer: Docker.Container) {
        /**
         *
         * @type {Docker.Container}
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
        if (await this.isRunning()) {
            return;
        }
        await this._container.start();
    }

    async restart() {
        if (!(await this.isRunning())) {
            return this.start();
        }
        await this._container.restart();
    }

    async stop() {
        if (!(await this.isRunning())) {
            return;
        }
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
            return await this._container.inspect();
        } catch (err) {
            return undefined;
        }
    }

    async status() {
        const result = await this.inspect();

        return result?.State;
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

            const hostPort = name.substring(CONTAINER_LABEL_PORT_PREFIX.length);

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

    async getLogStream() {
        try {
            const logStream = (await this.native.logs({
                stdout: true,
                stderr: true,
                follow: true,
                tail: 0,
                timestamps: true,
            })) as ReadStream;

            return new ClosableLogStream(logStream);
        } catch (err) {
            console.log('Error getting log stream', err);
            throw err;
        }
    }

    async getLogs(): Promise<LogEntry[]> {
        const logs = await this.native.logs({
            stdout: true,
            stderr: true,
            follow: false,
            timestamps: true,
        });

        const out = readLogBuffer(logs);
        if (out.length > 0) {
            return out;
        }

        const status = await this.status();
        const healthLogs: LogEntry[] = status?.Health?.Log
            ? status?.Health?.Log.map((log) => {
                  return {
                      source: 'stdout',
                      level: log.ExitCode === 0 ? 'INFO' : 'ERROR',
                      time: Date.now(),
                      message: 'Health check: ' + log.Output,
                  };
              })
            : [];

        if (status?.Running) {
            return [
                {
                    source: 'stdout',
                    level: 'INFO',
                    time: Date.now(),
                    message: 'Container is starting...',
                },
                ...healthLogs,
            ];
        }

        if (status?.Restarting) {
            return [
                {
                    source: 'stdout',
                    level: 'INFO',
                    time: Date.now(),
                    message: 'Container is restarting...',
                },
                ...healthLogs,
            ];
        }
        if (status?.Paused) {
            return [
                {
                    source: 'stdout',
                    level: 'INFO',
                    time: Date.now(),
                    message: 'Container is paused...',
                },
                ...healthLogs,
            ];
        }

        if (status?.Error) {
            return [
                {
                    source: 'stderr',
                    level: 'ERROR',
                    time: Date.now(),
                    message: 'Container failed to start:\n' + status.Error,
                },
                ...healthLogs,
            ];
        }

        return [
            {
                source: 'stdout',
                level: 'INFO',
                time: Date.now(),
                message: 'Container not running',
                ...healthLogs,
            },
        ];
    }
}

export function getExtraHosts(dockerVersion: string): string[] | undefined {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        const [major, minor] = dockerVersion.split('.');
        if (parseInt(major) >= 20 && parseInt(minor) >= 10) {
            // Docker 20.10+ on Linux supports adding host.docker.internal to point to host-gateway
            return [`${DOCKER_HOST_INTERNAL}:host-gateway`];
        }
        // Docker versions lower than 20.10 needs an actual IP address. We use the default network bridge which
        // is always 172.17.0.1
        return [`${DOCKER_HOST_INTERNAL}:172.17.0.1`];
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
