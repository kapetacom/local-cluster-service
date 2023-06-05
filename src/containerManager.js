const { Docker } = require('node-docker-api');
const path = require('path');
const _ = require('lodash');
const os = require('os');
const Path = require('path');
const storageService = require('./storageService');
const mkdirp = require('mkdirp');
const { parseKapetaUri } = require('@kapeta/nodejs-utils');

const ClusterConfiguration = require('@kapeta/local-cluster-config');

const LABEL_PORT_PREFIX = 'kapeta_port-';

const NANO_SECOND = 1000000;
const HEALTH_CHECK_INTERVAL = 2000;
const HEALTH_CHECK_MAX = 20;
const IMAGE_PULL_CACHE_TTL = 30 * 60 * 1000;
const IMAGE_PULL_CACHE = {};


const promisifyStream = (stream) =>
    new Promise((resolve, reject) => {
        stream.on('data', (d) => console.log(d.toString()));
        stream.on('end', resolve);
        stream.on('error', reject);
    });

class ContainerManager {
    constructor() {
        this._docker = null;
        this._alive = false;
        this._mountDir = Path.join(storageService.getKapetaBasedir(), 'mounts');
        mkdirp.sync(this._mountDir);
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
                          socketPath: path.join(
                              os.homedir(),
                              '.docker/run/docker.sock'
                          ),
                      },
                      // Default http
                      { protocol: 'http', host: 'localhost', port: 2375 },
                      { protocol: 'https', host: 'localhost', port: 2376 },
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

    getMountPoint(kind, mountName) {
        const kindUri = parseKapetaUri(kind);
        return Path.join(
            this._mountDir,
            kindUri.handle,
            kindUri.name,
            mountName
        );
    }

    createMounts(kind, mountOpts) {
        const mounts = {};

        _.forEach(mountOpts, (containerPath, mountName) => {
            const hostPath = this.getMountPoint(kind, mountName);
            mkdirp.sync(hostPath);
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
        } catch (e) {
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

    async getContainerByName(containerName) {
        const containers = await this.docker().container.list({ all: true });
        return containers.find((container) => {
            return container.data.Names.indexOf(`/${containerName}`) > -1;
        });
    }

    async pull(image, cacheForMS = IMAGE_PULL_CACHE_TTL) {
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
        }

        await this.docker()
            .image.create(
                {},
                {
                    fromImage: imageName,
                    tag: tag,
                }
            )
            .then((stream) => promisifyStream(stream));

        IMAGE_PULL_CACHE[image] = Date.now();
    }

    toDockerMounts(mounts) {
        const Mounts = [];
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

    toDockerHealth(health) {
        return {
            Test: ['CMD-SHELL', health.cmd],
            Interval: health.interval
                ? health.interval * NANO_SECOND
                : 5000 * NANO_SECOND,
            Timeout: health.timeout
                ? health.timeout * NANO_SECOND
                : 15000 * NANO_SECOND,
            Retries: health.retries || 10,
        };
    }

    /**
     *
     * @param {string} image
     * @param {string} name
     * @param {{ports:{},mounts:{},env:{}}} opts
     * @return {Promise<ContainerInfo>}
     */
    async run(image, name, opts) {
        const PortBindings = {};
        const Env = [];
        const Labels = {
            kapeta: 'true',
        };

        console.log('Pulling image: %s', image);

        await this.pull(image);

        console.log('Image pulled: %s', image);

        _.forEach(opts.ports, (portInfo, containerPort) => {
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
            Labels,
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

    async startContainer(opts) {
        const dockerContainer = await this.docker().container.create(opts);
        await dockerContainer.start();
        return dockerContainer;
    }

    async waitForReady(container, attempt) {
        if (!attempt) {
            attempt = 0;
        }

        if (attempt >= HEALTH_CHECK_MAX) {
            throw new Error(
                'Container did not become ready within the timeout'
            );
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

    async waitForHealthy(container, attempt) {
        if (!attempt) {
            attempt = 0;
        }

        if (attempt >= HEALTH_CHECK_MAX) {
            throw new Error(
                'Container did not become healthy within the timeout'
            );
        }

        if (await this._isHealthy(container)) {
            return;
        }

        return new Promise((resolve, reject) => {
            setTimeout(async () => {
                try {
                    await this.waitForHealthy(container, attempt + 1);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, HEALTH_CHECK_INTERVAL);
        });
    }

    async _isReady(container) {
        const info = await container.status();
        if (info?.data?.State?.Status === 'exited') {
            throw new Error('Container exited unexpectedly');
        }
        return info?.data?.State?.Running;
    }
    async _isHealthy(container) {
        const info = await container.status();
        return info?.data?.State?.Health?.Status === 'healthy';
    }

    /**
     *
     * @param name
     * @return {Promise<ContainerInfo>}
     */
    async get(name) {
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

class ContainerInfo {
    /**
     *
     * @param {Container} dockerContainer
     */
    constructor(dockerContainer) {
        /**
         *
         * @type {Container}
         * @private
         */
        this._container = dockerContainer;
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

    async remove(opts) {
        await this._container.delete({ force: !!opts.force });
    }

    async getPort(type) {
        const ports = await this.getPorts();

        if (ports[type]) {
            return ports[type];
        }

        return null;
    }

    async getStatus() {
        const result = await this._container.status();

        return result ? result.data : null;
    }

    async getPorts() {
        const inspectResult = await this.getStatus();

        if (
            !inspectResult ||
            !inspectResult.Config ||
            !inspectResult.Config.Labels
        ) {
            return false;
        }

        const portTypes = {};
        const ports = {};

        _.forEach(inspectResult.Config.Labels, (portType, name) => {
            if (!name.startsWith(LABEL_PORT_PREFIX)) {
                return;
            }

            const hostPort = name.substr(LABEL_PORT_PREFIX.length);

            portTypes[hostPort] = portType;
        });

        _.forEach(
            inspectResult.HostConfig.PortBindings,
            (portBindings, containerPortSpec) => {
                let [containerPort, protocol] = containerPortSpec.split(/\//);

                const hostPort = portBindings[0].HostPort;

                const portType = portTypes[hostPort];

                ports[portType] = {
                    containerPort,
                    protocol,
                    hostPort,
                };
            }
        );

        return ports;
    }
}

module.exports = new ContainerManager();
