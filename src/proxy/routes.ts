import Router from 'express-promise-router';
import { Request, Response } from 'express';
import { Resource } from '@kapeta/schemas';
import { proxyRestRequest } from './types/rest.js';
import { proxyWebRequest } from './types/web.js';
import { ProxyRequestHandler } from '../types.js';
import { stringBody, StringBodyRequest } from '../middleware/stringBody.js';
import { serviceManager } from '../serviceManager.js';
import { clusterService } from '../clusterService.js';
import { assetManager } from '../assetManager.js';

import _ from 'lodash';

const router = Router();
/**
 * @var {{[key:string]:ProxyRequestHandler}}
 */
const TYPE_HANDLERS: { [p: string]: ProxyRequestHandler } = {
    rest: proxyRestRequest,
    web: proxyWebRequest,
};

function getResource(resources: Resource[], resourceName: string) {
    return resources.find((resource) => {
        return resource.metadata.name.toLowerCase() === resourceName.toLowerCase();
    });
}

router.use('/:systemId/:consumerInstanceId/:consumerResourceName', stringBody);

router.all(
    '/:systemId/:consumerInstanceId/:consumerResourceName/:type/*',
    async (req: StringBodyRequest, res: Response) => {
        try {
            const typeHandler = TYPE_HANDLERS[req.params.type.toLowerCase()];
            if (!typeHandler) {
                res.status(401).send({ error: 'Unknown connection type: ' + req.params.type });
                return;
            }

            const plan = await assetManager.getPlan(req.params.systemId);

            // We can find the connection by the consumer information alone since
            // only 1 provider can be connected to a consumer resource at a time
            const connection = _.find(plan.spec.connections, (connection) => {
                return (
                    connection.consumer.blockId.toLowerCase() === req.params.consumerInstanceId.toLowerCase() &&
                    connection.consumer.resourceName.toLowerCase() === req.params.consumerResourceName.toLowerCase()
                );
            });

            if (!connection) {
                res.status(401).send({
                    error: `No connection found for consumer "${req.params.consumerInstanceId}::${req.params.consumerResourceName}"`,
                });
                return;
            }

            const toBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
                return blockInstance.id.toLowerCase() === connection.consumer.blockId.toLowerCase();
            });

            if (!toBlockInstance) {
                res.status(401).send({ error: `Block instance not found "${req.params.consumerInstanceId}` });
                return;
            }

            const toBlockAsset = await assetManager.getAsset(toBlockInstance.block.ref);

            if (!toBlockAsset) {
                res.status(401).send({ error: `Block asset not found "${toBlockInstance.block.ref}` });
                return;
            }

            const consumerResource = getResource(toBlockAsset.data.spec.consumers, req.params.consumerResourceName);

            if (!consumerResource) {
                res.status(401).send({
                    error: `Block resource not found "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`,
                });
                return;
            }

            const basePath = clusterService.getProxyPath(
                req.params.systemId,
                req.params.consumerInstanceId,
                req.params.consumerResourceName,
                req.params.type
            );

            const fromBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
                return blockInstance.id.toLowerCase() === connection.provider.blockId.toLowerCase();
            });

            if (!fromBlockInstance) {
                res.status(401).send({ error: `Block instance not found "${connection.provider.blockId}` });
                return;
            }

            const fromBlockAsset = await assetManager.getAsset(fromBlockInstance.block.ref);

            if (!fromBlockAsset) {
                res.status(401).send({ error: `Block asset not found "${fromBlockInstance.block.ref}` });
                return;
            }

            const providerResource = getResource(fromBlockAsset.data.spec.providers, connection.provider.resourceName);

            if (!providerResource) {
                res.status(401).send({
                    error: `Block resource not found "${connection.provider.blockId}::${connection.provider.resourceName}`,
                });
                return;
            }

            //Get target address
            let address = await serviceManager.getProviderAddress(
                req.params.systemId,
                connection.provider.blockId,
                req.params.type
            );

            while (address.endsWith('/')) {
                address = address.substring(0, address.length - 1);
            }

            /*
         Get the path the consumer requested.
         Note that this might not match the path the destination is expecting so we need to identify the method
         that is being called and identify the destination path from the connection.
         */
            const consumerPath = req.originalUrl.substring(basePath.length - 1);

            typeHandler(req, res, {
                consumerPath,
                address,
                consumerResource,
                providerResource,
                connection,
            });
        } catch (err: any) {
            console.warn('Failed to process proxy request', err);
            res.status(400).send({ error: err.message });
        }
    }
);

export default router;
