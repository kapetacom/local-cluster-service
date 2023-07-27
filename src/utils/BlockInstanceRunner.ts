import FS from 'node:fs';
import ClusterConfig, { DefinitionInfo } from '@kapeta/local-cluster-config';
import { getBindHost, getBlockInstanceContainerName, normalizeKapetaUri, readYML } from './utils';
import { KapetaURI, parseKapetaUri } from '@kapeta/nodejs-utils';
import { serviceManager } from '../serviceManager';
import { containerManager, DockerMounts, toLocalBindVolume } from '../containerManager';
import { LogData } from './LogData';
import EventEmitter from 'events';
import { clusterService } from '../clusterService';
import { AnyMap, BlockProcessParams, InstanceType, ProcessInfo, StringMap } from '../types';
import { Container } from 'node-docker-api/lib/container';
import { definitionsManager } from '../definitionsManager';
import md5 from 'md5';

const KIND_BLOCK_TYPE_OPERATOR = 'core/block-type-operator';
const KAPETA_SYSTEM_ID = 'KAPETA_SYSTEM_ID';
const KAPETA_BLOCK_REF = 'KAPETA_BLOCK_REF';
const KAPETA_INSTANCE_ID = 'KAPETA_INSTANCE_ID';

/**
 * Needed when running local docker containers as part of plan
 * @type {string[]}
 */
const DOCKER_ENV_VARS = [
    `KAPETA_LOCAL_SERVER=0.0.0.0`,
    `KAPETA_LOCAL_CLUSTER_HOST=host.docker.internal`,
    `KAPETA_ENVIRONMENT_TYPE=docker`,
];

function getProvider(uri: KapetaURI) {
    return definitionsManager.getProviderDefinitions().find((provider) => {
        const ref = `${provider.definition.metadata.name}:${provider.version}`;
        return parseKapetaUri(ref).id === uri.id;
    });
}

function getProviderPorts(assetVersion: DefinitionInfo): string[] {
    return (
        assetVersion.definition?.spec?.providers
            ?.map((provider: any) => {
                return provider.spec?.port?.type;
            })
            .filter((t: any) => !!t) ?? []
    );
}

export class BlockInstanceRunner {
    private readonly _systemId: string;

    constructor(systemId: string) {
        /**
         *
         * @type {string}
         * @private
         */
        this._systemId = normalizeKapetaUri(systemId);
    }

    /**
     * Start a block
     *
     */
    async start(blockRef: string, instanceId: string, configuration: AnyMap): Promise<ProcessInfo> {
        return this._execute({
            ref: blockRef,
            id: instanceId,
            configuration,
        });
    }

    private async _execute(blockInstance: BlockProcessParams): Promise<ProcessInfo> {
        const env: StringMap = {};

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

        const assetVersion = definitionsManager.getDefinitions().find((definitions) => {
            const ref = `${definitions.definition.metadata.name}:${definitions.version}`;
            return parseKapetaUri(ref).id === blockUri.id;
        });

        if (!assetVersion) {
            throw new Error(`Block definition not found: ${blockUri.id}`);
        }

        const kindUri = parseKapetaUri(assetVersion.definition.kind);

        const providerVersion = getProvider(kindUri);

        if (!providerVersion) {
            throw new Error(`Kind not found: ${kindUri.id}`);
        }

        let processInfo: ProcessInfo;

        if (providerVersion.definition.kind === KIND_BLOCK_TYPE_OPERATOR) {
            processInfo = await this._startOperatorProcess(blockInstance, blockUri, providerVersion, env);
        } else {
            //We need a port type to know how to connect to the block consistently
            const portTypes = getProviderPorts(assetVersion);

            if (blockUri.version === 'local') {
                processInfo = await this._startLocalProcess(blockInstance, blockUri, env, assetVersion);
            } else {
                processInfo = await this._startDockerProcess(blockInstance, blockUri, env, assetVersion);
            }

            if (portTypes.length > 0) {
                processInfo.portType = portTypes[0];
            }
        }

        return processInfo;
    }

    /**
     * Starts local process
     */
    private async _startLocalProcess(
        blockInstance: BlockProcessParams,
        blockInfo: KapetaURI,
        env: StringMap,
        assetVersion: DefinitionInfo
    ): Promise<ProcessInfo> {
        const baseDir = ClusterConfig.getRepositoryAssetPath(blockInfo.handle, blockInfo.name, blockInfo.version);

        if (!FS.existsSync(baseDir)) {
            throw new Error(
                `Local block not registered correctly - expected symlink here: ${baseDir}.\n` +
                    `Make sure you've run "blockctl registry link" in your local directory to connect it to Kapeta`
            );
        }

        if (!assetVersion.definition.spec?.target?.kind) {
            throw new Error('Missing target kind in block definition');
        }

        const kindUri = parseKapetaUri(assetVersion.definition.spec?.target?.kind);

        const targetVersion = getProvider(kindUri);

        if (!targetVersion) {
            throw new Error(`Target not found: ${kindUri.id}`);
        }

        const localContainer = targetVersion.definition.spec.local;

        if (!localContainer) {
            throw new Error(`Missing local container information from target: ${kindUri.id}`);
        }

        const dockerImage = localContainer.image;
        if (!dockerImage) {
            throw new Error(`Missing docker image information: ${JSON.stringify(localContainer)}`);
        }

        const containerName = getBlockInstanceContainerName(blockInstance.id);
        const startCmd = localContainer.handlers?.onCreate ? localContainer.handlers.onCreate : '';
        const dockerOpts = localContainer.options ?? {};
        const homeDir = localContainer.userHome ? localContainer.userHome : '/root';
        const workingDir = localContainer.workingDir ? localContainer.workingDir : '/workspace';

        const {
            PortBindings,
            ExposedPorts,
            addonEnv
        } = await this.getDockerPortBindings(blockInstance, assetVersion);

        let HealthCheck = undefined;
        if (localContainer.healthcheck) {
            HealthCheck = containerManager.toDockerHealth({ cmd: localContainer.healthcheck });
        }

        return this.ensureContainer({
            Image: dockerImage,
            name: containerName,
            WorkingDir: workingDir,
            Labels: {
                instance: blockInstance.id,
            },
            HealthCheck,
            ExposedPorts,
            Cmd: startCmd ? startCmd.split(/\s+/g) : [],
            Env: [
                ...DOCKER_ENV_VARS,
                `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                ...Object.entries({
                    ...env,
                    ...addonEnv,
                }).map(([key, value]) => `${key}=${value}`),
            ],
            HostConfig: {
                Binds: [
                    `${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${homeDir}/.kapeta`,
                    `${toLocalBindVolume(baseDir)}:${workingDir}`,
                ],
                PortBindings,
            },
            ...dockerOpts,
        });
    }

    private async _startDockerProcess(blockInstance: BlockProcessParams, blockInfo: KapetaURI, env: StringMap, assetVersion: DefinitionInfo) {
        const { versionFile } = ClusterConfig.getRepositoryAssetInfoPath(
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

        const {
            PortBindings,
            ExposedPorts,
            addonEnv
        } = await this.getDockerPortBindings(blockInstance, assetVersion);

        const containerName = getBlockInstanceContainerName(blockInstance.id);

        // For windows we need to default to root
        const innerHome = process.platform === 'win32' ? '/root/.kapeta' : ClusterConfig.getKapetaBasedir();

        return this.ensureContainer({
            Image: dockerImage,
            name: containerName,
            ExposedPorts,
            Labels: {
                instance: blockInstance.id,
            },
            Env: [
                ...DOCKER_ENV_VARS,
                `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                ...Object.entries({
                    ...env,
                    ...addonEnv
                }).map(([key, value]) => `${key}=${value}`),

            ],
            HostConfig: {
                Binds: [`${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${innerHome}`],
                PortBindings,
            },
        });
    }

    /**
     *
     * @param blockInstance
     * @param blockUri
     * @param providerDefinition
     * @param {{[key:string]:string}} env
     * @return {Promise<ProcessDetails>}
     * @private
     */
    async _startOperatorProcess(
        blockInstance: BlockProcessParams,
        blockUri: KapetaURI,
        providerDefinition: DefinitionInfo,
        env: StringMap
    ) {
        const { assetFile } = ClusterConfig.getRepositoryAssetInfoPath(
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

        const containerName = getBlockInstanceContainerName(blockInstance.id);
        const logs = new LogData();

        const bindHost = getBindHost();

        const ExposedPorts: AnyMap = {};
        const addonEnv: StringMap = {};
        const PortBindings: AnyMap = {};
        let HealthCheck = undefined;
        let Mounts: DockerMounts[] = [];
        const promises = Object.entries(spec.local.ports as { [p: string]: { port: string; type: string } }).map(
            async ([portType, value]) => {
                const dockerPort = `${value.port}/${value.type}`;
                ExposedPorts[dockerPort] = {};
                addonEnv[`KAPETA_LOCAL_SERVER_PORT_${portType.toUpperCase()}`] = value.port;
                const publicPort = await serviceManager.ensureServicePort(this._systemId, blockInstance.id, portType);
                PortBindings[dockerPort] = [
                    {
                        HostIp: bindHost,
                        HostPort: `${publicPort}`,
                    },
                ];
            }
        );

        await Promise.all(promises);

        if (spec.local?.env) {
            Object.entries(spec.local.env).forEach(([key, value]) => {
                addonEnv[key] = value as string;
            });
        }

        if (spec.local?.mounts) {
            const mounts = containerManager.createMounts(blockUri.id, spec.local.mounts);
            Mounts = containerManager.toDockerMounts(mounts);
        }

        if (spec.local?.health) {
            HealthCheck = containerManager.toDockerHealth(spec.local?.health);
        }

        // For windows we need to default to root
        const innerHome = process.platform === 'win32' ? '/root/.kapeta' : ClusterConfig.getKapetaBasedir();

        logs.addLog(`Creating new container for block: ${containerName}`);
        const out = await this.ensureContainer({
            Image: dockerImage,
            name: containerName,
            ExposedPorts,
            HealthCheck,
            HostConfig: {
                Binds: [
                    `${toLocalBindVolume(kapetaYmlPath)}:/kapeta.yml:ro`,
                    `${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${innerHome}`,
                ],
                PortBindings,
                Mounts,
            },
            Labels: {
                instance: blockInstance.id,
            },
            Env: [
                `KAPETA_INSTANCE_NAME=${blockInstance.ref}`,
                `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                ...DOCKER_ENV_VARS,
                ...Object.entries({
                    ...env,
                    ...addonEnv,
                }).map(([key, value]) => `${key}=${value}`),
            ],
        });

        const portTypes = spec.local.ports ? Object.keys(spec.local.ports) : [];
        if (portTypes.length > 0) {
            out.portType = portTypes[0];
        }

        return out;
    }


    private async getDockerPortBindings(blockInstance: BlockProcessParams, assetVersion: DefinitionInfo) {
        const bindHost = getBindHost();
        const ExposedPorts: AnyMap = {};
        const addonEnv: StringMap = {};
        const PortBindings: AnyMap = {};

        const portTypes = getProviderPorts(assetVersion);
        let port = 80;
        const promises = portTypes.map(async (portType) => {
            const publicPort = await serviceManager.ensureServicePort(this._systemId, blockInstance.id, portType);
            const thisPort = port++; //TODO: Not sure how we should handle multiple ports or non-HTTP ports
            const dockerPort = `${thisPort}/tcp`;
            ExposedPorts[dockerPort] = {};
            addonEnv[`KAPETA_LOCAL_SERVER_PORT_${portType.toUpperCase()}`] = '' + thisPort;

            PortBindings[dockerPort] = [
                {
                    HostIp: bindHost,
                    HostPort: `${publicPort}`,
                },
            ];
        });


        await Promise.all(promises);

        return {PortBindings,ExposedPorts, addonEnv};
    }

    private async ensureContainer(opts: any) {
        const logs = new LogData();

        const container = await containerManager.ensureContainer(opts);

        try {
            if (opts.HealthCheck) {
                await containerManager.waitForHealthy(container);
            } else {
                await containerManager.waitForReady(container);
            }
        } catch (e: any) {
            logs.addLog(e.message, 'ERROR');
        }

        return this._handleContainer(container, logs);
    }

    private async _handleContainer(
        container: Container,
        logs: LogData,
        deleteOnExit: boolean = false
    ): Promise<ProcessInfo> {
        let localContainer: Container | null = container;
        const logStream = (await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: LogData.MAX_LINES,
        })) as EventEmitter;

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
            const data = status.data as any;
            if (deleteOnExit) {
                try {
                    await containerManager.remove(container);
                } catch (e: any) {}
            }
            outputEvents.emit('exit', data?.State?.ExitCode ?? 0);
        });

        return {
            type: InstanceType.DOCKER,
            pid: container.id,
            output: outputEvents,
            stop: async () => {
                if (!localContainer) {
                    return;
                }

                try {
                    await localContainer.stop();
                    if (deleteOnExit) {
                        await containerManager.remove(localContainer);
                    }
                } catch (e) {}
                localContainer = null;
            },
            logs: () => {
                return logs.getLogs();
            },
        };
    }
}
