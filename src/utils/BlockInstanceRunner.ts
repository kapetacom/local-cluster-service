/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import FSExtra from 'fs-extra';
import ClusterConfig, { DefinitionInfo } from '@kapeta/local-cluster-config';
import { getDockerHostIp, getBlockInstanceContainerName, getOperatorInstancePorts, readYML, toPortInfo } from './utils';
import { KapetaURI, parseKapetaUri, normalizeKapetaUri } from '@kapeta/nodejs-utils';
import { DEFAULT_PORT_TYPE, HTTP_PORT_TYPE, HTTP_PORTS, serviceManager } from '../serviceManager';
import {
    COMPOSE_LABEL_PROJECT,
    COMPOSE_LABEL_SERVICE,
    CONTAINER_LABEL_PORT_PREFIX,
    containerManager,
    DockerMounts,
    toLocalBindVolume,
} from '../containerManager';
import { LogData } from './LogData';
import { clusterService } from '../clusterService';
import {
    AnyMap,
    BlockProcessParams,
    DOCKER_HOST_INTERNAL,
    InstanceType,
    KIND_BLOCK_TYPE_OPERATOR,
    ProcessInfo,
    StringMap,
} from '../types';
import { definitionsManager } from '../definitionsManager';
import Docker from 'dockerode';
import OS from 'node:os';
import Path from 'node:path';
import { taskManager } from '../taskManager';
import { LocalDevContainer, LocalInstance } from '@kapeta/schemas';
import { createInternalConfigProvider } from './InternalConfigProvider';
import { resolveKapetaVariables, writeConfigTemplates } from '@kapeta/config-mapper';

const KAPETA_SYSTEM_ID = 'KAPETA_SYSTEM_ID';
const KAPETA_BLOCK_REF = 'KAPETA_BLOCK_REF';
const KAPETA_INSTANCE_ID = 'KAPETA_INSTANCE_ID';

/**
 * Needed when running local docker containers as part of plan
 * @type {string[]}
 */
const DOCKER_ENV_VARS = [
    `KAPETA_LOCAL_SERVER=0.0.0.0`,
    `KAPETA_LOCAL_CLUSTER_HOST=${DOCKER_HOST_INTERNAL}`,
    `KAPETA_ENVIRONMENT_TYPE=docker`,
    `KAPETA_ENVIRONMENT_PLATFORM=${OS.platform()}`
];

async function getProvider(uri: KapetaURI) {
    const providers = await definitionsManager.getProviderDefinitions();
    return providers.find((provider) => {
        const ref = `${provider.definition.metadata.name}:${provider.version}`;
        return parseKapetaUri(ref).id === uri.id;
    });
}

export function resolvePortType(portType: string) {
    if (portType && HTTP_PORTS.includes(portType.toLowerCase())) {
        return HTTP_PORT_TYPE;
    }
    return portType;
}

/**
 * Get the port types for a non-operator block instance
 */
function getServiceProviderPorts(assetVersion: DefinitionInfo, providerVersion: DefinitionInfo): string[] {
    const out =
        assetVersion.definition?.spec?.providers
            ?.filter((provider: any) => {
                // We only support HTTP provider ports for now. Need to figure out how to handle other types
                return HTTP_PORTS.includes(provider.spec?.port?.type?.toLowerCase());
            })
            ?.map((provider: any) => {
                return resolvePortType(provider.spec?.port?.type?.toLowerCase());
            })
            .filter((t: any) => !!t) ?? [];

    if (out.length === 0) {
        if (providerVersion.definition.spec?.defaultPort?.type) {
            return [resolvePortType(providerVersion.definition.spec?.defaultPort?.type)];
        }
        return [resolvePortType(DEFAULT_PORT_TYPE)];
    }
    // Duplicated port types are not allowed
    return Array.from(new Set<string>(out));
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
        const blockUri = parseKapetaUri(blockInstance.ref);

        if (!blockUri.version) {
            blockUri.version = 'local';
        }

        const assetVersion = await definitionsManager.getDefinition(blockUri.id);

        if (!assetVersion) {
            throw new Error(`Block definition not found: ${blockUri.id}`);
        }

        const kindUri = parseKapetaUri(assetVersion.definition.kind);

        const providerVersion = await getProvider(kindUri);

        if (!providerVersion) {
            throw new Error(`Kind not found: ${kindUri.id}`);
        }

        const baseDir = ClusterConfig.getRepositoryAssetPath(blockUri.handle, blockUri.name, blockUri.version);
        const realBaseDir = await FSExtra.realpath(baseDir);
        const internalConfigProvider = await createInternalConfigProvider(
            this._systemId,
            blockInstance.id,
            assetVersion
        );

        // Resolve the environment variables
        const envVars = await resolveKapetaVariables(realBaseDir, internalConfigProvider);

        // Write out the config templates if they exist
        await writeConfigTemplates(envVars, realBaseDir);

        let processInfo: ProcessInfo;

        if (providerVersion.definition.kind === KIND_BLOCK_TYPE_OPERATOR) {
            processInfo = await this._startOperatorProcess(blockInstance, blockUri, providerVersion, envVars);
        } else {
            //We need a port type to know how to connect to the block consistently
            const portTypes = getServiceProviderPorts(assetVersion, providerVersion);

            if (blockUri.version === 'local') {
                processInfo = await this._startLocalProcess(blockInstance, blockUri, envVars, assetVersion);
            } else {
                processInfo = await this._startDockerProcess(blockInstance, blockUri, envVars, assetVersion);
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

        if (!FSExtra.existsSync(baseDir)) {
            throw new Error(
                `Local block not registered correctly - expected symlink here: ${baseDir}.\n` +
                    `Make sure you've run "kap registry link" in your local directory to connect it to Kapeta`
            );
        }

        if (!assetVersion.definition.spec?.target?.kind) {
            throw new Error('Missing target kind in block definition');
        }

        const realLocalPath = await FSExtra.realpath(baseDir);

        const kindUri = parseKapetaUri(assetVersion.definition.kind);

        const providerVersion = await getProvider(kindUri);

        if (!providerVersion) {
            throw new Error(`Block type not found: ${kindUri.id}`);
        }

        const targetKindUri = parseKapetaUri(assetVersion.definition.spec?.target?.kind);

        const targetVersion = await getProvider(targetKindUri);

        if (!targetVersion) {
            throw new Error(`Target not found: ${targetKindUri.id}`);
        }

        const localContainer = targetVersion.definition.spec.local as LocalDevContainer;

        if (!localContainer) {
            throw new Error(`Missing local container information from target: ${targetKindUri.id}`);
        }

        let dockerImage = localContainer.image;
        const isDockerImage = !localContainer.type || localContainer.type.toLowerCase() === 'docker';
        const isDockerFile = Boolean(localContainer.type && localContainer.type.toLowerCase() === 'dockerfile');
        if (isDockerImage && !dockerImage) {
            throw new Error(`Missing docker image information: ${JSON.stringify(localContainer)}`);
        }

        if (isDockerFile) {
            dockerImage = blockInfo.fullName + ':local';
            const dockerFile = Path.join(realLocalPath, localContainer.file ?? 'Dockerfile');
            if (!FSExtra.existsSync(dockerFile)) {
                throw new Error(`Dockerfile not found at: ${dockerFile}`);
            }
            const task = containerManager.buildDockerImage(dockerFile, blockInfo.fullName + ':local');
            await task.wait();
        }

        const containerName = await getBlockInstanceContainerName(this._systemId, blockInstance.id, targetKindUri.id);
        const startCmd = localContainer.handlers?.onCreate ? localContainer.handlers.onCreate : '';
        const dockerOpts = localContainer.options ?? {};
        const homeDir = localContainer.userHome ? localContainer.userHome : '/root';
        const workingDir = localContainer.workingDir ? localContainer.workingDir : '/workspace';

        const customHostConfigs = localContainer.HostConfig ?? {};
        const Binds = customHostConfigs.Binds ?? [];
        delete customHostConfigs.Binds;
        const customLabels = localContainer.Labels ?? {};
        const customEnvs = localContainer.Env ?? [];
        delete localContainer.HostConfig;
        delete localContainer.Labels;
        delete localContainer.Env;

        const { PortBindings, ExposedPorts, addonEnv } = await this.getServiceBlockPortBindings(
            blockInstance,
            assetVersion,
            providerVersion
        );

        let HealthCheck = undefined;
        if (localContainer.healthcheck) {
            HealthCheck = containerManager.toDockerHealth({ cmd: localContainer.healthcheck });
        }

        const Mounts = isDockerImage
            ? // For docker images we mount the local directory to the working directory
              containerManager.toDockerMounts({
                  [workingDir]: toLocalBindVolume(realLocalPath),
              })
            : // For dockerfiles we don't mount anything
              [];

        const systemUri = parseKapetaUri(this._systemId);

        return this.ensureContainer({
            ...dockerOpts,
            Image: dockerImage,
            name: containerName,
            WorkingDir: workingDir,
            Labels: {
                ...customLabels,
                instance: blockInstance.id,
                [COMPOSE_LABEL_PROJECT]: systemUri.id.replace(/[^a-z0-9]/gi, '_'),
                [COMPOSE_LABEL_SERVICE]: blockInfo.id.replace(/[^a-z0-9]/gi, '_'),
            },
            HealthCheck,
            ExposedPorts,
            Cmd: startCmd ? startCmd.split(/\s+/g) : [],
            Env: [
                ...customEnvs,
                ...DOCKER_ENV_VARS,
                `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                ...Object.entries({
                    ...env,
                    ...addonEnv,
                }).map(([key, value]) => `${key}=${value}`),
            ],
            HostConfig: {
                ...customHostConfigs,
                Binds: [
                    `${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${homeDir}/.kapeta`,
                    ...Binds.map((bind: string) => {
                        let [host, container] = bind.split(':');
                        if (host.startsWith('~')) {
                            host = OS.homedir() + host.substring(1);
                        }

                        if (container.startsWith('~')) {
                            container = homeDir + container.substring(1);
                        }

                        return `${toLocalBindVolume(host)}:${container}`;
                    }),
                ],
                PortBindings,
                Mounts,
            },
        });
    }

    private async _startDockerProcess(
        blockInstance: BlockProcessParams,
        blockInfo: KapetaURI,
        env: StringMap,
        assetVersion: DefinitionInfo
    ) {
        const { versionFile } = ClusterConfig.getRepositoryAssetInfoPath(
            blockInfo.handle,
            blockInfo.name,
            blockInfo.version
        );

        const versionYml = versionFile;
        if (!FSExtra.existsSync(versionYml)) {
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

        const kindUri = parseKapetaUri(assetVersion.definition.kind);

        const providerVersion = await getProvider(kindUri);

        if (!providerVersion) {
            throw new Error(`Block type not found: ${kindUri.id}`);
        }

        const { PortBindings, ExposedPorts, addonEnv } = await this.getServiceBlockPortBindings(
            blockInstance,
            assetVersion,
            providerVersion
        );

        const containerName = await getBlockInstanceContainerName(this._systemId, blockInstance.id, kindUri.id);

        // For windows we need to default to root
        const innerHome = process.platform === 'win32' ? '/root/.kapeta' : ClusterConfig.getKapetaBasedir();
        const systemUri = parseKapetaUri(this._systemId);

        return this.ensureContainer({
            Image: dockerImage,
            name: containerName,
            ExposedPorts,
            Labels: {
                instance: blockInstance.id,
                [COMPOSE_LABEL_PROJECT]: systemUri.id.replace(/[^a-z0-9]/gi, '_'),
                [COMPOSE_LABEL_SERVICE]: blockInfo.id.replace(/[^a-z0-9]/gi, '_'),
            },
            Env: [
                ...DOCKER_ENV_VARS,
                `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                ...Object.entries({
                    ...env,
                    ...addonEnv,
                }).map(([key, value]) => `${key}=${value}`),
            ],
            HostConfig: {
                Binds: [`${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${innerHome}`],
                PortBindings,
            },
        });
    }

    private async _startOperatorProcess(
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
        if (!FSExtra.existsSync(kapetaYmlPath)) {
            throw new Error(`Did not find kapeta.yml at the expected path: ${kapetaYmlPath}`);
        }

        const spec = providerDefinition.definition.spec;
        const providerRef = `${providerDefinition.definition.metadata.name}:${providerDefinition.version}`;

        if (!spec?.local?.image) {
            throw new Error(`Provider did not have local image: ${providerRef}`);
        }

        const local = spec.local as LocalInstance;

        const dockerImage = local.image;
        const operatorUri = local.singleton ? parseKapetaUri(providerRef) : blockUri;
        const operatorId = local.singleton ? providerRef : blockInstance.id;
        const operatorRef = local.singleton ? providerRef : blockInstance.ref;

        if (local.singleton && env) {
            env[KAPETA_BLOCK_REF] = operatorRef;
            env[KAPETA_INSTANCE_ID] = operatorId;
        }

        const containerName = await getBlockInstanceContainerName(this._systemId, blockInstance.id, providerRef);

        const task = taskManager.add(
            `container:start:${containerName}`,
            async () => {
                const logs = new LogData();
                const hostIp = getDockerHostIp();

                const ExposedPorts: AnyMap = {};
                const addonEnv: StringMap = {};
                const PortBindings: AnyMap = {};
                let HealthCheck = undefined;
                let Mounts: DockerMounts[] = [];
                const instancePorts = await getOperatorInstancePorts(this._systemId, operatorId, local);
                const labels: { [key: string]: string } = {};
                instancePorts.forEach((portInfo) => {
                    const dockerPort = `${portInfo.port}/${portInfo.protocol}`;
                    ExposedPorts[dockerPort] = {};
                    addonEnv[`KAPETA_LOCAL_SERVER_PORT_${portInfo.portType.toUpperCase()}`] = `${portInfo.port}`;

                    PortBindings[dockerPort] = [
                        {
                            HostIp: hostIp,
                            HostPort: `${portInfo.hostPort}`,
                        },
                    ];

                    labels[CONTAINER_LABEL_PORT_PREFIX + portInfo.hostPort] = portInfo.portType;
                });

                if (local.env) {
                    Object.entries(local.env).forEach(([key, value]) => {
                        addonEnv[key] = value as string;
                    });
                }

                if (local.mounts) {
                    Mounts = await containerManager.createVolumes(this._systemId, operatorUri.id, local.mounts);
                }

                if (local.health) {
                    HealthCheck = containerManager.toDockerHealth(local.health);
                }

                // For windows we need to default to root
                const innerHome = process.platform === 'win32' ? '/root/.kapeta' : ClusterConfig.getKapetaBasedir();

                const Binds = local.singleton
                    ? [`${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${innerHome}`]
                    : [
                          `${toLocalBindVolume(kapetaYmlPath)}:/kapeta.yml:ro`,
                          `${toLocalBindVolume(ClusterConfig.getKapetaBasedir())}:${innerHome}`,
                      ];

                const systemUri = parseKapetaUri(this._systemId);

                console.log(
                    `Ensuring container for operator block: ${containerName} [singleton: ${!!local.singleton}]`
                );

                logs.addLog(`Ensuring container for operator block: ${containerName}`);
                const out = await this.ensureContainer({
                    Image: dockerImage,
                    name: containerName,
                    ExposedPorts,
                    HealthCheck,
                    HostConfig: {
                        Binds,
                        PortBindings,
                        Mounts,
                    },
                    Labels: {
                        ...labels,
                        instance: operatorId,
                        [COMPOSE_LABEL_PROJECT]: systemUri.id.replace(/[^a-z0-9]/gi, '_'),
                        [COMPOSE_LABEL_SERVICE]: operatorUri.id.replace(/[^a-z0-9]/gi, '_'),
                    },
                    Env: [
                        `KAPETA_INSTANCE_NAME=${operatorRef}`,
                        `KAPETA_LOCAL_CLUSTER_PORT=${clusterService.getClusterServicePort()}`,
                        ...DOCKER_ENV_VARS,
                        ...Object.entries({
                            ...env,
                            ...addonEnv,
                        }).map(([key, value]) => `${key}=${value}`),
                    ],
                });

                const portTypes = local.ports ? Object.keys(local.ports) : [];
                if (portTypes.length > 0) {
                    out.portType = portTypes[0];
                }

                return out;
            },
            {
                name: `Starting container for ${providerRef}`,
                systemId: this._systemId,
            }
        );

        return task.wait();
    }

    /**
     * Get the port bindings for a non-operator block
     */
    private async getServiceBlockPortBindings(
        blockInstance: BlockProcessParams,
        assetVersion: DefinitionInfo,
        providerVersion: DefinitionInfo
    ) {
        const hostIp = getDockerHostIp();
        const ExposedPorts: AnyMap = {};
        const addonEnv: StringMap = {};
        const PortBindings: AnyMap = {};

        const portTypes = getServiceProviderPorts(assetVersion, providerVersion);
        let port = 80;
        const promises = portTypes.map(async (portType) => {
            const publicPort = await serviceManager.ensureServicePort(this._systemId, blockInstance.id, portType);
            const thisPort = port++; //TODO: Not sure how we should handle multiple ports or non-HTTP ports
            const dockerPort = `${thisPort}/tcp`;
            ExposedPorts[dockerPort] = {};
            addonEnv[`KAPETA_LOCAL_SERVER_PORT_${portType.toUpperCase()}`] = '' + thisPort;

            PortBindings[dockerPort] = [
                {
                    HostIp: hostIp,
                    HostPort: `${publicPort}`,
                },
            ];
        });

        await Promise.all(promises);

        return { PortBindings, ExposedPorts, addonEnv };
    }

    private async ensureContainer(opts: any) {
        const container = await containerManager.ensureContainer(opts);

        return this._handleContainer(container);
    }

    private async _handleContainer(container: Docker.Container): Promise<ProcessInfo> {
        return {
            type: InstanceType.DOCKER,
            pid: container.id,
        };
    }
}
