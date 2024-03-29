/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { EnrichedAsset } from './assetManager';
import { BlockInstance } from '@kapeta/schemas';
import { storageService } from './storageService';
import { assetManager } from './assetManager';
import { normalizeKapetaUri, parseKapetaUri } from '@kapeta/nodejs-utils';
import { getResolvedConfiguration } from './utils/utils';

export const SYSTEM_ID = '$plan';
type AnyMap = { [key: string]: any };

interface MatchedIdentity {
    systemId: string;
    instanceId: string;
}

class ConfigManager {
    private _config: AnyMap;

    constructor() {
        this._config = storageService.section('config');
    }

    _forSystem(systemId: string) {
        systemId = normalizeKapetaUri(systemId);
        if (!this._config[systemId]) {
            this._config[systemId] = {};
        }

        return this._config[systemId];
    }

    setConfigForSystem(systemId: string, config: AnyMap) {
        systemId = normalizeKapetaUri(systemId);
        const systemConfig = config || {};

        storageService.put('config', systemId, systemConfig);
    }

    getConfigForSystem(systemId: string): AnyMap {
        systemId = normalizeKapetaUri(systemId);
        return this._forSystem(systemId);
    }

    async getConfigForBlockInstance(systemId: string, instanceId: string) {
        const blockInstance = await assetManager.getBlockInstance(systemId, instanceId);
        const blockAsset = await assetManager.getAsset(blockInstance.block.ref, true);
        if (!blockAsset) {
            throw new Error(`Block definition not found: ${blockInstance.block.ref}`);
        }
        const instanceConfig = this.getConfigForSection(systemId, instanceId);
        return getResolvedConfiguration(
            blockAsset.data.spec.configuration,
            instanceConfig,
            blockInstance.defaultConfiguration
        );
    }

    setConfigForSection(systemId: string, sectionId: string, config: AnyMap) {
        systemId = normalizeKapetaUri(systemId);
        let systemConfig = this._forSystem(systemId);
        systemConfig[sectionId] = config || {};

        storageService.put('config', systemId, systemConfig);
    }

    getConfigForSection(systemId: string, sectionId: string) {
        systemId = normalizeKapetaUri(systemId);
        const systemConfig = this._forSystem(systemId);

        if (!systemConfig[sectionId]) {
            systemConfig[sectionId] = {};
        }

        return systemConfig[sectionId];
    }

    /**
     * Try to identify the plan and instance in a plan automatically based on the block reference
     *
     * It will:
     * 1. Go through all plans available in the assets
     * 2. Look through each plan and see if the plan is referencing the block
     * 3. If only 1 plan references the block - assume that as the system id
     * 4. If only 1 instance in 1 plan references the block - assume that as instance id
     *
     * In case multiple uses of the same block reference we will prompt to user to choose which instance they want to
     * use.
     *
     * @param blockRef block reference
     * @param [systemId] plan reference
     * @returns {Promise<{systemId:string,instanceId:string}>}
     */
    async resolveIdentity(blockRef: string, systemId?: string) {
        blockRef = normalizeKapetaUri(blockRef);
        if (systemId) {
            systemId = normalizeKapetaUri(systemId);
        }
        const planAssets = await assetManager.getPlans();

        const blockUri = parseKapetaUri(blockRef);

        let matchingIdentities: MatchedIdentity[] = [];
        planAssets.forEach((planAsset: EnrichedAsset) => {
            if (systemId && planAsset.ref !== systemId) {
                //Skip plans that do not match systemid if provided
                return;
            }

            if (!planAsset.data.spec.blocks) {
                return;
            }

            planAsset.data.spec.blocks.forEach((blockInstance: BlockInstance) => {
                const refUri = parseKapetaUri(blockInstance.block.ref);
                if (refUri.equals(blockUri)) {
                    matchingIdentities.push({
                        systemId: normalizeKapetaUri(planAsset.ref),
                        instanceId: blockInstance.id,
                    });
                }
            });
        });

        if (matchingIdentities.length === 0) {
            if (systemId) {
                throw new Error(`No uses of block "${blockRef}" was found in plan: "${systemId}"`);
            }

            throw new Error(`No uses of block "${blockRef}" was found in any known plan`);
        }

        if (matchingIdentities.length > 1) {
            if (systemId) {
                throw new Error(
                    `Multiple uses of block "${blockRef}" was found in plan: "${systemId}". Please specify which instance in the plan you wish to run.`
                );
            }

            throw new Error(
                `Multiple uses of block "${blockRef}" was found in 1 or more plan. Please specify which instance in which plan you wish to run.`
            );
        }

        return matchingIdentities[0];
    }

    async verifyIdentity(blockRef: string, systemId: string, instanceId: string) {
        blockRef = normalizeKapetaUri(blockRef);
        systemId = normalizeKapetaUri(systemId);
        const planAssets = await assetManager.getPlans();
        const systemUri = systemId ? parseKapetaUri(systemId) : null;
        const blockUri = parseKapetaUri(blockRef);
        let found = false;
        planAssets.forEach((planAsset: EnrichedAsset) => {
            if (systemUri && !parseKapetaUri(planAsset.ref).equals(systemUri)) {
                //Skip plans that do not match systemid if provided
                return;
            }

            planAsset.data.spec.blocks.forEach((blockInstance: BlockInstance) => {
                if (blockInstance.id === instanceId && parseKapetaUri(blockInstance.block.ref).equals(blockUri)) {
                    found = true;
                }
            });
        });

        if (!found) {
            throw new Error(
                `Block "${blockRef}" was not found in plan: "${systemId}" using instance id ${instanceId}. Please verify that the provided information is accurate.`
            );
        }
    }
}

export const configManager = new ConfigManager();
