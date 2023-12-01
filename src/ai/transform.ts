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

export const transformToPlan = async (handle: string, application: Application): Promise<PlanContext> => {
    const blockTypeService = await definitionsManager.getLatestDefinition('kapeta/block-type-service');
    const blockTypeFrontend = await definitionsManager.getLatestDefinition('kapeta/block-type-frontend');
    const mongoDbResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-mongodb');
    const postgresResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-postgresql');
    const webPageResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-web-page');
    const restApiResource = await definitionsManager.getLatestDefinition('kapeta/resource-type-rest-api');
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
        !restApiResource
    ) {
        throw new Error('Missing definitions');
    }

    const plan: Plan = {
        kind: 'core/plan',
        metadata: {
            name: `${handle}/${application.name}`,
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
        const top = Math.floor(plan.spec.blocks.length / 3) * 300;
        const left = 200 + (plan.spec.blocks.length % 3) * 250;

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

    application.backends.forEach((backend) => {
        const language = backend.targetLanguage === 'java' ? javaLanguage : nodejsLanguage;
        const databaseInfo = backend.databases?.[0]!;
        const database = databaseInfo.type === 'mongodb' ? mongoDbResource : postgresResource;
        const blockName = `${handle}/${backend.name}`;
        const blockRef = normalizeKapetaUri(blockName + ':local');
        blocks.push({
            kind: normalizeKapetaUri(`${blockTypeService.definition.metadata.name}:${blockTypeService.version}`),
            metadata: {
                name: blockName,
                title: backend.title,
                description: backend.description,
                visibility: 'private',
            },
            spec: {
                target: {
                    kind: normalizeKapetaUri(`${language.definition.metadata.name}:${language.version}`),
                    options: {},
                },
                consumers: [
                    {
                        kind: normalizeKapetaUri(`${database.definition.metadata.name}:${database.version}`),
                        metadata: {
                            name: databaseInfo.name,
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
    });

    application.frontends.forEach((frontend) => {
        const language = reactLanguage;
        const blockName = `${handle}/${frontend.name}`;
        const blockRef = normalizeKapetaUri(blockName + ':local');
        blocks.push({
            kind: normalizeKapetaUri(`${blockTypeFrontend.definition.metadata.name}:${blockTypeFrontend.version}`),
            metadata: {
                name: blockName,
                title: frontend.title,
                description: frontend.description,
                visibility: 'private',
            },
            spec: {
                target: {
                    kind: normalizeKapetaUri(`${language.definition.metadata.name}:${language.version}`),
                    options: {},
                },
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
    });

    application.connections?.forEach((connection) => {
        const providerName = `${handle}/${connection.provider.name}`;
        const providerRef = normalizeKapetaUri(`${providerName}:local`);
        const consumerRef = normalizeKapetaUri(`${handle}/${connection.consumer.name}:local`);

        const instanceProvider = plan.spec.blocks.find((b) => b.block.ref === providerRef)!;
        const instanceConsumer = plan.spec.blocks.find((b) => b.block.ref === consumerRef)!;

        const block = blocks.find((block) => block.metadata.name === providerName)!;
        const portType = parseKapetaUri(block.kind).fullName === 'kapeta/block-type-service' ? 'rest' : 'web';

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
                resourceName: 'main',
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
