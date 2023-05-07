const {spawn} = require('node:child_process');
const FS = require('node:fs');
const Path = require('node:path');
const {Docker} = require('node-docker-api');
const ClusterConfig = require("@kapeta/local-cluster-config");
const {readYML} = require("./utils");
const {parseKapetaUri} = require("@kapeta/nodejs-utils");
const serviceManager = require("../serviceManager");
const containerManager = require("../containerManager");
const LogData = require("./LogData");
const EventEmitter = require("events");
const md5 = require('md5');
const {execSync} = require("child_process");

const KIND_BLOCK_TYPE_OPERATOR = 'core/block-type-operator';
const KAPETA_SYSTEM_ID = "KAPETA_SYSTEM_ID";
const KAPETA_BLOCK_REF = "KAPETA_BLOCK_REF";
const KAPETA_INSTANCE_ID = "KAPETA_INSTANCE_ID";
/**
 * Needed when running local docker containers as part of plan
 * @type {string[]}
 */
const DOCKER_ENV_VARS = [
    `KAPETA_LOCAL_SERVER=0.0.0.0`,
    `KAPETA_LOCAL_CLUSTER_HOST=host.docker.internal`,
    `KAPETA_ENVIRONMENT_TYPE=docker`,
]


class BlockInstanceRunner {
    /**
     * @param {string} [planReference]
     * @param {BlockInstanceInfo[]} [instances]
     */
    constructor(planReference) {
        /**
         *
         * @type {string}
         * @private
         */
        this._systemId = planReference ?? '';
    }



    /**
     * Start a block
     *
     * @param {string} blockRef
     * @param {string} instanceId
     * @param {any} configuration
     * @returns {Promise<ProcessInfo>}
     */
    async start(blockRef, instanceId, configuration) {
        return this._execute({
            ref: blockRef,
            id: instanceId,
            configuration
        });
    }

    /**
     *
     * @param {BlockInstanceInfo} blockInstance
     * @return {Promise<ProcessInfo>}
     * @private
     */
    async _execute(blockInstance) {
        const env = Object.assign({}, process.env);

        if (this._systemId) {
            env[KAPETA_SYSTEM_ID] = this._systemId;
        }

        if (blockInstance.ref) {
            env[KAPETA_BLOCK_REF] = blockInstance.ref;
        }

        if (blockInstance.id) {
            env[KAPETA_INSTANCE_ID] = blockInstance.id;
        }

        const blockUri = parseKapetaUri(blockInstance.ref);

        if (!blockUri.version) {
            blockUri.version = 'local';
        }

        const definition = ClusterConfig.getDefinitions().find(definitions => {
            const ref = `${definitions.definition.metadata.name}:${definitions.version}`
            return parseKapetaUri(ref).id === blockUri.id;
        });

        if (!definition) {
            throw new Error(`Block definition not found: ${blockUri.id}`);
        }

        const kindUri = parseKapetaUri(definition.definition.kind);

        const provider = ClusterConfig.getProviderDefinitions().find(provider => {
            const ref = `${provider.definition.metadata.name}:${provider.version}`
            return parseKapetaUri(ref).id === kindUri.id;
        });

        if (!provider) {
            throw new Error(`Kind not found: ${kindUri.id}`);
        }

        /**
         * @type {ProcessDetails}
         */
        let processDetails;

        if (provider.definition.kind === KIND_BLOCK_TYPE_OPERATOR) {
            processDetails = await this._startOperatorProcess(blockInstance, blockUri, provider, env);
        } else {
            if (blockUri.version === 'local') {
                processDetails = await this._startLocalProcess(blockInstance, blockUri, env);
            } else {
                processDetails = await this._startDockerProcess(blockInstance, blockUri, env);
            }
        }

        return {
            ...blockInstance,
            ...processDetails
        };
    }


    /**
     * Starts local process
     * @param {BlockInstanceInfo} blockInstance
     * @param {BlockInfo} blockInfo
     * @param {EnvironmentVariables} env
     * @return {ProcessDetails}
     * @private
     */
    _startLocalProcess(blockInstance, blockInfo, env) {
        const baseDir = ClusterConfig.getRepositoryAssetPath(
            blockInfo.handle,
            blockInfo.name,
            blockInfo.version
        );

        if (!FS.existsSync(baseDir)) {
            throw new Error(
                `Local block not registered correctly - expected symlink here: ${baseDir}.\n` +
                `Make sure you've run "blockctl registry link" in your local directory to connect it to Kapeta`
            );
        }

        const startScript = Path.resolve(baseDir, 'scripts/start.sh');
        if (!FS.existsSync(startScript)) {
            throw new Error(
                `Start script did not exist for local block.\n` +
                `Expected runnable start script here: ${startScript}`
            )
        }

        const logs = new LogData();
        const childProcess = spawn(startScript, [], {
            cwd: baseDir,
            env,
            detached: true,
            stdio: [
                'pipe', 'pipe', 'pipe'
            ]
        });

        logs.addLog(`Starting block ${blockInstance.ref} using script ${startScript}`);
        const outputEvents = new EventEmitter();
        /**
         *
         * @type {ProcessDetails}
         */
        const out = {
            type: 'local',
            pid: childProcess.pid,
            output: outputEvents,
            stderr: childProcess.stderr,
            logs: () => {
                return logs.getLogs();
            },
            stop: () => {
                childProcess.kill('SIGTERM');
            }
        };

        childProcess.stdout.on('data', (data) => {
            logs.addLog(data.toString());
            outputEvents.emit('data', data);
        });

        childProcess.stderr.on('data', (data) => {
            logs.addLog(data.toString());
            outputEvents.emit('data', data);
        });

        childProcess.on('exit', (code) => {
            logs.addLog(`Block ${blockInstance.ref} exited with code: ${code}`);
            outputEvents.emit('exit', code);
        });

        return out;
    }

    async _handleContainer(container, logs , deleteOnExit = false) {
        const logStream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: LogData.MAX_LINES
        })

        const outputEvents = new EventEmitter();
        logStream.on('data', (data) => {
            logs.addLog(data.toString());
            outputEvents.emit('data', data);
        });

        logStream.on('error', (data) => {
            logs.addLog(data.toString());
            outputEvents.emit('data', data);
        });

        logStream.on('close', async () => {
            const status = await container.status();
            if (deleteOnExit) {
                try {
                    await container.delete()
                } catch (e) {}
            }
            outputEvents.emit('exit', status.data?.State?.ExitCode ?? 0);
        });
        /**
         *
         * @type {ProcessDetails}
         */
        return {
            type: 'docker',
            pid: container.id,
            output: outputEvents,
            stop: async () => {
                if (!container) {
                    return;
                }

                try {
                    await container.stop();
                    if (deleteOnExit) {
                        await container.delete();
                    }
                } catch (e) {}
                container = null;
            },
            logs: () => {
                return logs.getLogs();
            }
        };
    }


    /**
     * Starts local process using docker
     * @param {BlockInstanceInfo} blockInstance
     * @param {BlockInfo} blockInfo
     * @param {EnvironmentVariables} env
     * @return {Promise<ProcessDetails>}
     * @private
     */
    async _startDockerProcess(blockInstance, blockInfo, env) {
        const {versionFile} = ClusterConfig.getRepositoryAssetInfoPath(
            blockInfo.handle,
            blockInfo.name,
            blockInfo.version
        );

        const versionYml = versionFile;
        if (!FS.existsSync(versionYml)) {
            throw new Error(`Did not find version info at the expected path: ${versionYml}`);
        }

        const versionInfo = readYML(versionYml);

        if (versionInfo?.artifact?.type !== 'docker') {
            throw new Error(`Unsupported artifact type: ${versionInfo?.artifact?.type}`);
        }
        const dockerImage = versionInfo?.artifact?.details?.primary;
        if (!dockerImage) {
            throw new Error(`Missing docker image information: ${JSON.stringify(versionInfo?.artifact?.details)}`);
        }

        const containerName = `kapeta-block-instance-${blockInstance.id}`;
        const logs = new LogData();
        let container = await containerManager.getContainerByName(containerName);

        if (container) {
            if (container.data.State === 'running') {
                logs.addLog(`Found existing running container for block: ${containerName}`);
            } else {
                logs.addLog(`Found existing container for block: ${containerName}. Starting now`);
                await container.start();
            }
        } else {
            logs.addLog(`Creating new container for block: ${containerName}`);
            container = await containerManager.startContainer({
                Image: dockerImage,
                name: containerName,
                Binds: [
                    `${ClusterConfig.getKapetaBasedir()}:${ClusterConfig.getKapetaBasedir()}`
                ],
                Labels: {
                    'instance': blockInstance.id
                },
                Env: [
                    ...DOCKER_ENV_VARS,
                    ...Object.entries(env).map(([key, value]) => `${key}=${value}`)
                ]
            });
        }

        return this._handleContainer(container, logs);
    }

    async _startOperatorProcess(blockInstance, blockUri, providerDefinition, env) {
        const {assetFile} = ClusterConfig.getRepositoryAssetInfoPath(
            blockUri.handle,
            blockUri.name,
            blockUri.version
        );

        const kapetaYmlPath = assetFile;
        if (!FS.existsSync(kapetaYmlPath)) {
            throw new Error(`Did not find kapeta.yml at the expected path: ${kapetaYmlPath}`);
        }

        const spec = providerDefinition.definition.spec;
        const providerRef = `${providerDefinition.definition.metadata.name}:${providerDefinition.version}`;

        if (!spec?.local?.image) {
            throw new Error(`Provider did not have local image: ${providerRef}`);
        }

        const dockerImage = spec?.local?.image;

        try {
            await containerManager.pull(dockerImage);
        } catch (e) {
            console.warn('Failed to pull image. Continuing...', e);
        }

        const containerName = `kapeta-block-instance-${md5(blockInstance.id)}`;
        const logs = new LogData();
        let container = await containerManager.getContainerByName(containerName);

        if (container) {
            if (container.data.State === 'running') {
                logs.addLog(`Found existing running container for block: ${containerName}`);
            } else {
                if (container.data.State?.ExitCode > 0) {
                    logs.addLog(`Container exited with code: ${container.data.State.ExitCode}. Deleting...`);
                    try {
                        await container.delete()
                    } catch (e) {}
                    container = null;
                } else {
                    logs.addLog(`Found existing container for block: ${containerName}. Starting now`);
                    try {
                        await container.start();
                    } catch (e) {
                        console.warn('Failed to start container. Deleting...', e);
                        try {
                            await container.delete()
                        } catch (e) {}
                        container = null;
                    }
                }
            }
        }

        if (!container) {
            const ExposedPorts = {};
            const addonEnv = {};
            const PortBindings = {};
            let HealthCheck = undefined;
            let Mounts = [];
            const promises = Object.entries(spec.local.ports)
                .map(async ([portType, value]) => {
                    const dockerPort = `${value.port}/${value.type}`;
                    ExposedPorts[dockerPort] = {};
                    addonEnv[`KAPETA_LOCAL_SERVER_PORT_${portType.toUpperCase()}`] = value.port;
                    const publicPort = await serviceManager.ensureServicePort(this._systemId, blockInstance.id, portType);
                    PortBindings[dockerPort] = [
                        {
                            HostIp: "127.0.0.1", //No public
                            HostPort: `${publicPort}`
                        }
                    ];
                });

            await Promise.all(promises);

            if (spec.local?.env) {
                Object.entries(spec.local.env).forEach(([key, value]) => {
                    addonEnv[key] = value;
                });
            }

            if (spec.local?.mounts) {
                const mounts = containerManager.createMounts(blockUri.id, spec.local.mounts);
                Mounts = containerManager.toDockerMounts(mounts);
            }

            if (spec.local?.health) {
                HealthCheck = containerManager.toDockerHealth(spec.local?.health);
            }

            logs.addLog(`Creating new container for block: ${containerName}`);
            container = await containerManager.startContainer({
                Image: dockerImage,
                name: containerName,
                ExposedPorts,
                HealthCheck,
                HostConfig: {
                    Binds: [
                        `${kapetaYmlPath}:/kapeta.yml:ro`,
                        `${ClusterConfig.getKapetaBasedir()}:${ClusterConfig.getKapetaBasedir()}`
                    ],
                    PortBindings,
                    Mounts
                },
                Labels: {
                    'instance': blockInstance.id
                },
                Env: [
                    `KAPETA_INSTANCE_NAME=${blockInstance.ref}`,
                    ...DOCKER_ENV_VARS,
                    ...Object.entries({
                        ...env,
                        ...addonEnv
                    }).map(([key, value]) => `${key}=${value}`)
                ]
            });

            if (HealthCheck) {
                await containerManager.waitForHealthy(container);
            }
        }

        return this._handleContainer(container, logs, true);
    }
}

module.exports = BlockInstanceRunner;
