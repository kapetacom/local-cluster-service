/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */
import { BlockDefinition, Plan } from '@kapeta/schemas';
import { Application } from './types';
import { definitionsManager } from '../definitionsManager';
import { normalizeKapetaUri, parseKapetaUri } from '@kapeta/nodejs-utils';
import uuid from 'node-uuid';

export type PlanContext = {
    plan: Plan;
    blocks: BlockDefinition[];
};

async function getFreeName(name: string) {
    let currentName = name;
    let iteration = 1;
    do {
        const found = await definitionsManager.getLatestDefinition(currentName);
        if (!found) {
            return currentName;
        }
        currentName = name + '_' + iteration++;
    } while (true);
}

export const transformToPlan = async (handle: string, application: Application): Promise<PlanContext> => {
    const blockTypeService = await definitionsManager.getLatestDefinition('kapeta/block-type-service');
    const blockTypeFrontend = await definitionsManager.getLatestDefinition('kapeta/block-type-frontend');
    const mongoDbResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-mongodb');
    const postgresResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-postgresql');
    const webPageResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-web-page');
    const webFragmentResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-web-fragment');
    const restApiResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-rest-api');
    const restClientResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-rest-client');
    const javaLanguage = await definitionsManager.getLatestDefinition('kapeta/language-target-java-spring-boot');
    const nodejsLanguage = await definitionsManager.getLatestDefinition('kapeta/language-target-nodejs');
    const reactLanguage = await definitionsManager.getLatestDefinition('kapeta/language-target-react-ts');

    if (
        !blockTypeService ||
        !blockTypeFrontend ||
        !mongoDbResource ||
        !postgresResource ||
        !javaLanguage ||
        !nodejsLanguage ||
        !reactLanguage ||
        !webPageResource ||
        !restApiResource ||
        !restClientResource ||
        !webFragmentResource
    ) {
        throw new Error('Missing definitions');
    }

    const plan: Plan = {
        kind: 'core/plan',
        metadata: {
            name: await getFreeName(`${handle}/${application.name}`),
            title: application.title,
            description: application.description,
            visibility: 'private',
        },
        spec: {
            blocks: [],
            connections: [],
        },
    };

    const blocks: BlockDefinition[] = [];

    const addToPlan = (ref: string, name: string) => {
        const top = 100 + Math.floor(plan.spec.blocks.length / 3) * 300;
        const left = 200 + (plan.spec.blocks.length % 3) * 450;

        plan.spec.blocks.push({
            block: {
                ref,
            },
            name,
            id: uuid.v4(),
            dimensions: {
                top,
                left,
                width: -1,
                height: -1,
            },
        });
    };

    const nameMapper = new Map<string, string>();

    for (const backend of application.backends) {
        const blockName = `${handle}/${backend.name}`;
        const blockRealName = await getFreeName(blockName);
        nameMapper.set(blockName, blockRealName);

        const language = backend.targetLanguage === 'java' ? javaLanguage : nodejsLanguage;
        const databaseInfo = backend.databases?.[0];
        const database = databaseInfo?.type === 'mongodb' ? mongoDbResource : postgresResource;

        const blockRef = normalizeKapetaUri(blockRealName + ':local');
        let targetOptions = {};
        if (backend.targetLanguage === 'java') {
            targetOptions = {
                basePackage: `${handle}.${application.name}`.toLowerCase().replace(/-/g, '_'),
                groupId: `${handle}.${application.name}`.toLowerCase().replace(/-/g, '_'),
                artifactId: backend.name.toLowerCase().replace(/-/g, '_'),
            };
        }
        blocks.push({
            kind: normalizeKapetaUri(`${blockTypeService.definition.metadata.name}:${blockTypeService.version}`),
            metadata: {
                name: blockRealName,
                title: backend.title,
                description: backend.description,
                visibility: 'private',
            },
            spec: {
                target: {
                    kind: normalizeKapetaUri(`${language.definition.metadata.name}:${language.version}`),
                    options: targetOptions,
                },
                consumers: [
                    {
                        kind: normalizeKapetaUri(`${database.definition.metadata.name}:${database.version}`),
                        metadata: {
                            name: (databaseInfo?.name ?? 'main').replace(/-/g, ''),
                        },
                        spec: {
                            port: {
                                type: database.definition.spec.ports[0].type,
                            },
                        },
                    },
                ],
                providers: [
                    {
                        kind: normalizeKapetaUri(
                            `${restApiResource.definition.metadata.name}:${restApiResource.version}`
                        ),
                        metadata: {
                            name: 'main',
                        },
                        spec: {
                            port: {
                                type: restApiResource.definition.spec.ports[0].type,
                            },
                        },
                    },
                ],
            },
        });

        addToPlan(blockRef, backend.name);
    }

    for (const frontend of application.frontends) {
        const blockName = `${handle}/${frontend.name}`;
        const blockRealName = await getFreeName(blockName);
        nameMapper.set(blockName, blockRealName);

        const language = reactLanguage;

        const blockRef = normalizeKapetaUri(blockRealName + ':local');
        blocks.push({
            kind: normalizeKapetaUri(`${blockTypeFrontend.definition.metadata.name}:${blockTypeFrontend.version}`),
            metadata: {
                name: blockRealName,
                title: frontend.title,
                description: frontend.description,
                visibility: 'private',
            },
            spec: {
                target: {
                    kind: normalizeKapetaUri(`${language.definition.metadata.name}:${language.version}`),
                    options: {},
                },
                consumers: [],
                providers: [
                    {
                        kind: normalizeKapetaUri(
                            `${webPageResource.definition.metadata.name}:${webPageResource.version}`
                        ),
                        metadata: {
                            name: 'main',
                        },
                        spec: {
                            port: {
                                type: webPageResource.definition.spec.ports[0].type,
                            },
                        },
                    },
                ],
            },
        });

        addToPlan(blockRef, frontend.name);
    }

    application.connections?.forEach((connection) => {
        const fullProviderName = nameMapper.get(`${handle}/${connection.provider.name}`) as string;
        const fullConsumerName = nameMapper.get(`${handle}/${connection.consumer.name}`) as string;
        const consumerResourceName = connection.provider.name;
        const providerRef = normalizeKapetaUri(`${fullProviderName}:local`);
        const consumerRef = normalizeKapetaUri(`${fullConsumerName}:local`);

        const instanceProvider = plan.spec.blocks.find((b) => b.block.ref === providerRef)!;
        const instanceConsumer = plan.spec.blocks.find((b) => b.block.ref === consumerRef)!;
        const consumerBlock = blocks.find((block) => block.metadata.name === fullConsumerName);
        const providerBlock = blocks.find((block) => block.metadata.name === fullProviderName);
        if (!consumerBlock) {
            throw new Error('Missing consumer block: ' + fullConsumerName);
        }

        if (!providerBlock) {
            throw new Error('Missing provider block: ' + fullProviderName);
        }

        const portType = parseKapetaUri(providerBlock.kind).fullName === 'kapeta/block-type-service' ? 'rest' : 'web';

        if (portType === 'rest') {
            consumerBlock.spec.consumers!.push({
                kind: normalizeKapetaUri(
                    `${restClientResource.definition.metadata.name}:${restClientResource.version}`
                ),
                metadata: {
                    name: consumerResourceName,
                },
                spec: {
                    port: {
                        type: 'rest',
                    },
                },
            });
        } else {
            consumerBlock.spec.consumers!.push({
                kind: normalizeKapetaUri(
                    `${webFragmentResource.definition.metadata.name}:${webFragmentResource.version}`
                ),
                metadata: {
                    name: consumerResourceName,
                },
                spec: {
                    port: {
                        type: 'web',
                    },
                },
            });
        }

        plan.spec.connections.push({
            provider: {
                blockId: instanceProvider.id,
                resourceName: 'main',
                port: {
                    type: portType,
                },
            },
            consumer: {
                blockId: instanceConsumer.id,
                resourceName: consumerResourceName,
                port: {
                    type: portType,
                },
            },
        });
    });

    return {
        plan,
        blocks,
    };
};
