const {Docker} = require("node-docker-api");
const path = require("path");
const _ = require('lodash');
const FS = require("node:fs");
const os = require("os");
const LABEL_PORT_PREFIX = "kapeta_port-";

const NANO_SECOND = 1000000;
const HEALTH_CHECK_INTERVAL = 1000;
const HEALTH_CHECK_MAX = 20;

const promisifyStream = (stream) =>
    new Promise((resolve, reject) => {
        stream.on("data", (d) => console.log(d.toString()));
        stream.on("end", resolve);
        stream.on("error", reject);
    });

class ContainerManager {
    constructor() {
        this._docker = null;
        this._alive = false;
    }

    isAlive() {
        return this._alive;
    }

    async initialize() {
        // try
        const connectOptions = [
            // use defaults: DOCKER_HOST etc from env, if available
            undefined,
            // default linux
            {socketPath: "/var/run/docker.sock"},
            // default macOS
            {socketPath: path.join(os.homedir(), ".docker/run/docker.sock")},
            // Default http
            {protocol: "http", host: "localhost", port: 2375},
            {protocol: "https", host: "localhost", port: 2376},
        ];
        for (const opts of connectOptions) {
            try {
                const client = new Docker(opts);
                await client.ping();
                this._docker = client;
                return;
            } catch (err) {
                // silently ignore bad configs
            }
        }
        throw new Error("Unable to connect to docker");
    }

    async ping() {
        await this._docker.ping();
        this._alive = true;
    }

    async ping() {

        try {
            const pingResult = await this._docker.ping();
            if (pingResult !== 'OK') {
                throw new Error(`Ping failed: ${pingResult}`);
            }
        } catch (e) {
            throw new Error(`Docker not running. Please start the docker daemon before running this command. Error: ${e.message}`);
        }

        this._alive = true;
    }

    async ensureAlive() {
        if (!this._alive) {
            await this.ping();
        }
    }

    async docker() {
        await this.ensureAlive();
        return this._docker;
    }

    async getContainerByName(containerName) {
        const containers = await this._docker.container.list({all: true});
        return containers.find(container => {
            return container.data.Names.indexOf(`/${containerName}`) > -1;
        });
    }

    async pull(image) {
        let [imageName, tag] = image.split(/:/);
        if (!tag) {
            tag = 'latest';
        }

        await this._docker.image
            .create(
                {},
                {
                    fromImage: imageName,
                    tag: tag,
                }
            )
            .then((stream) => promisifyStream(stream));
    }

    /**
     *
     * @param {string} image
     * @param {string} name
     * @param {{ports:{},mounts:{},env:{}}} opts
     * @return {Promise<ContainerInfo>}
     */
    async run(image, name, opts) {
        const Mounts = [];
        const PortBindings = {};
        const Env = [];
        const Labels = {
            kapeta: "true",
        };

        console.log("Pulling image: %s", image);

        await this.pull(image);

        console.log("Image pulled: %s", image);

        _.forEach(opts.ports, (portInfo, containerPort) => {
            PortBindings['' + containerPort] = [
                {
                    HostPort: '' + portInfo.hostPort,
                    HostIp: '127.0.0.1'
                }
            ];

            Labels[LABEL_PORT_PREFIX + portInfo.hostPort] = portInfo.type;
        });

        _.forEach(opts.mounts, (Source, Target) => {
            Mounts.push({
                Target,
                Source,
                Type: "bind",
                ReadOnly: false,
                Consistency: "consistent",
            });
        });

        _.forEach(opts.env, (value, name) => {
            Env.push(name + "=" + value);
        });

        let HealthCheck = undefined;

        if (opts.health) {
            HealthCheck = {
                Test: ["CMD-SHELL", opts.health.cmd],
                Interval: opts.health.interval
                    ? opts.health.interval * NANO_SECOND
                    : 5000 * NANO_SECOND,
                Timeout: opts.health.timeout
                    ? opts.health.timeout * NANO_SECOND
                    : 15000 * NANO_SECOND,
                Retries: opts.health.retries || 10,
            };

            console.log("Adding health check", HealthCheck);
        }


        const dockerContainer = await this.startContainer({
            name: name,
            Image: image,
            Labels,
            Env,
            HealthCheck,
            HostConfig: {
                PortBindings,
                Mounts
            }
        });

        if (opts.health) {
            await this._waitForHealthy(dockerContainer);
        }

        return new ContainerInfo(dockerContainer);
    }

    async startContainer(opts) {
        const dockerContainer = await this._docker.container.create(opts);

        await dockerContainer.start();

        return dockerContainer;
    }


    async _waitForHealthy(container, attempt) {
        if (!attempt) {
            attempt = 0;
        }

        if (attempt >= HEALTH_CHECK_MAX) {
            throw new Error("Operator did not become healthy within the timeout");
        }

        if (await this._isHealthy(container)) {
            console.log("Container became healthy");
            return;
        }

        return new Promise((resolve) => {
            setTimeout(async () => {
                await this._waitForHealthy(container, attempt + 1);
                resolve();
            }, HEALTH_CHECK_INTERVAL);
        });
    }

    async _isHealthy(container) {
        const info = await container.status();

        return info?.data?.State?.Health?.Status === "healthy";
    }

    /**
     *
     * @param name
     * @return {Promise<ContainerInfo>}
     */
    async get(name) {
        let dockerContainer = null;

        try {
            dockerContainer = await this._docker.container.get(name);
            await dockerContainer.status();
        } catch (err) {
            //Ignore
            console.log("Container not available - creating it: %s", name);
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
        await this._container.delete({force: !!opts.force});
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
