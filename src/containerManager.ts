import Path from 'path';
import { storageService } from './storageService';
import os from 'os';
import _ from 'lodash';
import FSExtra, { ReadStream } from 'fs-extra';
import { Docker } from 'node-docker-api';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import { Container } from 'node-docker-api/lib/container';

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

interface Health {
    cmd: string;
    interval?: number;
    timeout?: number;
    retries?: number;
}

const LABEL_PORT_PREFIX = 'kapeta_port-';
const NANO_SECOND = 1000000;
const HEALTH_CHECK_INTERVAL = 2000;
const HEALTH_CHECK_MAX = 30;
const IMAGE_PULL_CACHE_TTL = 30 * 60 * 1000;
const IMAGE_PULL_CACHE: { [key: string]: number } = {};

const promisifyStream = (stream: ReadStream) =>
    new Promise((resolve, reject) => {
        stream.on('data', (d) => console.log(d.toString()));
        stream.on('end', resolve);
        stream.on('error', reject);
    });

class ContainerManager {
    private _docker: Docker | null;
    private _alive: boolean;
    private _mountDir: string;

    constructor() {
        this._docker = null;
        this._alive = false;
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
                this._alive = true;
                return;
            } catch (err) {
                // silently ignore bad configs
            }
        }

        throw new Error('Could not connect to docker daemon. Please make sure docker is running and working.');
    }

    isAlive() {
        return this._alive;
    }

    getMountPoint(kind: string, mountName: string) {
        const kindUri = parseKapetaUri(kind);
        return Path.join(this._mountDir, kindUri.handle, kindUri.name, mountName);
    }

    createMounts(kind: string, mountOpts: StringMap): StringMap {
        const mounts: StringMap = {};

        _.forEach(mountOpts, (containerPath, mountName) => {
            const hostPath = this.getMountPoint(kind, mountName);
            FSExtra.mkdirpSync(hostPath);
            mounts[containerPath] = hostPath;
        });
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

    async getContainerByName(containerName: string): Promise<Container | undefined> {
        const containers = await this.docker().container.list({ all: true });
        return containers.find((container) => {
            return (container.data as any).Names.indexOf(`/${containerName}`) > -1;
        });
    }

    async pull(image: string, cacheForMS: number = IMAGE_PULL_CACHE_TTL) {
        let [imageName, tag] = image.split(/:/);
        if (!tag) {
            tag = 'latest';
        }

        if (tag !== 'latest') {
            if (IMAGE_PULL_CACHE[image]) {
                const timeSince = Date.now() - IMAGE_PULL_CACHE[image];
                if (timeSince < cacheForMS) {
                    return;
                }
            }

            const imageTagList = (await this.docker().image.list())
                .map((image) => image.data as any)
                .filter((imageData) => !!imageData.RepoTags)
                .map((imageData) => imageData.RepoTags as string[]);

            if (imageTagList.some((imageTags) => imageTags.indexOf(image) > -1)) {
                console.log('Image found: %s', image);
                return;
            }
            console.log('Image not found: %s', image);
        }

        console.log('Pulling image: %s', image);
        await this.docker()
            .image.create(
                {},
                {
                    fromImage: imageName,
                    tag: tag,
                }
            )
            .then((stream) => promisifyStream(stream as ReadStream));

        IMAGE_PULL_CACHE[image] = Date.now();

        console.log('Image pulled: %s', image);
    }

    toDockerMounts(mounts: StringMap) {
        const Mounts: DockerMounts[] = [];
        _.forEach(mounts, (Source, Target) => {
            Mounts.push({
                Target,
                Source,
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

    async run(
        image: string,
        name: string,
        opts: { ports: {}; mounts: {}; env: {}; cmd: string; health: Health }
    ): Promise<ContainerInfo> {
        const PortBindings: { [key: string]: any } = {};
        const Env: string[] = [];
        const Labels: StringMap = {
            kapeta: 'true',
        };

        await this.pull(image);

        const ExposedPorts: { [key: string]: any } = {};

        _.forEach(opts.ports, (portInfo: any, containerPort) => {
            ExposedPorts['' + containerPort] = {};
            PortBindings['' + containerPort] = [
                {
                    HostPort: '' + portInfo.hostPort,
                    HostIp: '127.0.0.1',
                },
            ];

            Labels[LABEL_PORT_PREFIX + portInfo.hostPort] = portInfo.type;
        });

        const Mounts = this.toDockerMounts(opts.mounts);

        _.forEach(opts.env, (value, name) => {
            Env.push(name + '=' + value);
        });

        let HealthCheck = undefined;

        if (opts.health) {
            HealthCheck = this.toDockerHealth(opts.health);
        }
        const dockerContainer = await this.startContainer({
            name: name,
            Image: image,
            Hostname: name + '.kapeta',
            Labels,
            Cmd: opts.cmd,

            ExposedPorts,
            Env,
            HealthCheck,
            HostConfig: {
                PortBindings,
                Mounts,
            },
        });

        if (opts.health) {
            await this.waitForHealthy(dockerContainer);
        }

        return new ContainerInfo(dockerContainer);
    }

    async startContainer(opts: any) {
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

    async waitForHealthy(container: Container, attempt?: number): Promise<void> {
        if (!attempt) {
            attempt = 0;
        }

        if (attempt >= HEALTH_CHECK_MAX) {
            throw new Error('Container did not become healthy within the timeout');
        }

        if (await this._isHealthy(container)) {
            return;
        }

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    await this.waitForHealthy(container, (attempt ?? 0) + 1);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, HEALTH_CHECK_INTERVAL);
        });
    }

    async _isReady(container: Container) {
        const info: Container = await container.status();
        const infoData: any = info?.data;
        if (infoData?.State?.Status === 'exited') {
            throw new Error('Container exited unexpectedly');
        }
        return infoData?.State?.Running ?? false;
    }

    async _isHealthy(container: Container) {
        const info = await container.status();
        const infoData: any = info?.data;
        return infoData?.State?.Health?.Status === 'healthy';
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
        const inspectResult = await this.getStatus();

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
        await this._container.delete({ force: !!opts?.force });
    }

    async getPort(type: string) {
        const ports = await this.getPorts();

        if (ports && ports[type]) {
            return ports[type];
        }

        return null;
    }

    async getStatus() {
        const result = await this._container.status();

        return result ? (result.data as any) : null;
    }

    async getPorts(): Promise<PortMap | false> {
        const inspectResult = await this.getStatus();

        if (!inspectResult || !inspectResult.Config || !inspectResult.Config.Labels) {
            return false;
        }

        const portTypes: StringMap = {};
        const ports: PortMap = {};

        _.forEach(inspectResult.Config.Labels, (portType, name) => {
            if (!name.startsWith(LABEL_PORT_PREFIX)) {
                return;
            }

            const hostPort = name.substr(LABEL_PORT_PREFIX.length);

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
}

export const containerManager = new ContainerManager();