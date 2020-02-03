const {Router} = require('express');
const _ = require('lodash');

const router = new Router();
const serviceManager = require('../serviceManager');
const clusterService = require('../clusterService');
const assetManager = require('../assetManager');

/**
 * @var {{[key:string]:ProxyRequestHandler}}
 */
const TYPE_HANDLERS = {
    rest: require('./types/rest'),
    web: require('./types/web')
};

function getResource(resources, resourceName) {
    return _.find(resources, (resource) => {
        return (resource.metadata.name.toLowerCase() === resourceName.toLowerCase());
    });
}

router.use('/:systemId/:consumerInstanceId/:consumerResourceName', require('../middleware/stringBody'));

router.all('/:systemId/:consumerInstanceId/:consumerResourceName/:type/*', async (req, res) => {

    try {

        const typeHandler = TYPE_HANDLERS[req.params.type.toLowerCase()];
        if (!typeHandler) {
            res.status(401).send({error: 'Unknown connection type: ' + req.params.type});
            return;
        }

        const plan = await assetManager.getPlan(req.params.systemId);

        // We can find the connection by the consumer information alone since
        // only 1 provider can be connected to a consumer resource at a time
        const connection = _.find(plan.spec.connections, (connection) => {
            return connection.to.blockId.toLowerCase() === req.params.consumerInstanceId.toLowerCase() &&
                connection.to.resourceName.toLowerCase() === req.params.consumerResourceName.toLowerCase();
        });

        if (!connection) {
            res.status(401).send({error:`No connection found for consumer "${req.params.consumerInstanceId}::${req.params.consumerResourceName}"`});
            return;
        }

        const toBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
            return blockInstance.id.toLowerCase() === connection.to.blockId.toLowerCase();
        });

        if (!toBlockInstance) {
            res.status(401).send({error:`Block instance not found "${req.params.consumerInstanceId}`});
            return;
        }

        const toBlockAsset = await assetManager.getAsset(toBlockInstance.block.ref);

        const toResource = getResource(toBlockAsset.data.spec.consumers, req.params.consumerResourceName);

        if (!toResource) {
            res.status(401).send({error:`Block resource not found "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`});
            return;
        }

        const basePath = clusterService.getProxyPath(
            req.params.systemId,
            req.params.consumerInstanceId,
            req.params.consumerResourceName,
            req.params.type
        );

        /*
         Get the path the consumer requested.
         Note that this might not match the path the destination is expecting so we need to identify the method
         that is being called and identify the destination path from the connection.
         */
        const consumerPath = req.originalUrl.substr(basePath.length - 1);

        const fromBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
            return blockInstance.id.toLowerCase() === connection.from.blockId.toLowerCase();
        });

        if (!fromBlockInstance) {
            res.status(401).send({error:`Block instance not found "${connection.from.blockId}`});
            return;
        }

        const fromBlockAsset = await assetManager.getAsset(fromBlockInstance.block.ref);

        const fromResource = getResource(fromBlockAsset.data.spec.providers, connection.from.resourceName);

        if (!fromResource) {
            res.status(401).send({error:`Block resource not found "${connection.from.blockId}::${connection.from.resourceName}`});
            return;
        }


        //Get target address
        let address = await serviceManager.getProviderAddress(
            req.params.systemId,
            connection.from.blockId,
            req.params.type
        );

        while(address.endsWith('/')) {
            address = address.substr(0, address.length - 1);
        }

        typeHandler(req, res, {
            consumerPath,
            address,
            toResource,
            fromResource,
            connection
        });

    } catch(err) {
        res.status(400).send({error: err.message});
    }

});

module.exports = router;