const _ = require('lodash');
const storageService = require('./storageService');
const assetManager = require('./assetManager');
const {parseKapetaUri} = require("@kapeta/nodejs-utils");

class ConfigManager {

    constructor() {
        this._config = storageService.section('config');
    }

    _forSystem(systemId) {
        if (!this._config[systemId]) {
            this._config[systemId] = {};
        }

        return this._config[systemId];
    }

    setConfigForService(systemId, serviceId, config) {
        const systemConfig = this._forSystem(systemId);
        systemConfig[serviceId] = config || {};

        storageService.put('config', systemId, systemConfig);
    }

    getConfigForService(systemId, serviceId) {
        const systemConfig = this._forSystem(systemId);

        if (!systemConfig[serviceId]) {
            systemConfig[serviceId] = {};
        }

        if (!systemConfig[serviceId].kapeta) {
            systemConfig[serviceId].kapeta = {};
        }

        return systemConfig[serviceId];
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
    async resolveIdentity(blockRef, systemId) {
        const planAssets = assetManager.getPlans();

        const blockUri = parseKapetaUri(blockRef);

        let matchingIdentities = [];
        planAssets.forEach((planAsset) => {
            if (systemId && planAsset.ref !== systemId) {
                //Skip plans that do not match systemid if provided
                return;
            }

            if (!planAsset.data.spec.blocks) {
                return;
            }

            planAsset.data.spec.blocks.forEach((blockInstance) => {
                const refUri = parseKapetaUri(blockInstance.block.ref);
                if (refUri.equals(blockUri)) {
                    matchingIdentities.push({
                        systemId: planAsset.ref,
                        instanceId: blockInstance.id
                    });
                }
            });
        });

        if (matchingIdentities.length === 0) {
            if (systemId) {
                throw new Error(`No uses of block "${blockRef}" was found in plan: "${systemId}"`)
            }

            throw new Error(`No uses of block "${blockRef}" was found any known plan`);
        }

        if (matchingIdentities.length > 1) {
            if (systemId) {
                throw new Error(`Multiple uses of block "${blockRef}" was found in plan: "${systemId}". Please specify which instance in the plan you wish to run.`)
            }

            throw new Error(`Multiple uses of block "${blockRef}" was found in 1 or more plan. Please specify which instance in which plan you wish to run.`);
        }


        return matchingIdentities[0];
    }

    async verifyIdentity(blockRef, systemId, instanceId) {
        const planAssets = await assetManager.getPlans();

        let found = false;
        planAssets.forEach((planAsset) => {
            if (planAsset.ref !== systemId) {
                //Skip plans that do not match systemid if provided
                return;
            }

            planAsset.data.spec.blocks.forEach((blockInstance) => {
                if (blockInstance.id === instanceId &&
                    blockInstance.block.ref === blockRef) {
                    found = true;
                }
            });
        });

        if (!found) {
            throw new Error(`Block "${blockRef}" was not found in plan: "${systemId}" using instance id ${instanceId}. Please verify that the provided information is accurate.`);
        }
    }
}

module.exports = new ConfigManager();
