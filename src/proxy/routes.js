const {Router} = require('express');
const request = require('request');
const Path = require('path');
const _ = require('lodash');

const router = new Router();
const networkManager = require('../networkManager');
const serviceManager = require('../serviceManager');
const clusterService = require('../clusterService');
const assetManager = require('../assetManager');
const socketManager = require('../socketManager');
const pathTemplateParser = require('../utils/pathTemplateParser');

function getResource(resources, resourceName) {
    return _.find(resources, (resource) => {
        return (resource.metadata.name === resourceName);
    });
}

function getRestMethodId(restResource, httpMethod, httpPath) {
    return _.findKey(restResource.spec.methods, (method) => {
        let methodType = method.method ? method.method.toUpperCase() : 'GET';

        if (methodType !== httpMethod.toUpperCase()) {
            return false;
        }

        let path = method.path;

        if (restResource.spec.basePath) {
            path = Path.join(restResource.spec.basePath, path);
        }

        const pathTemplate = pathTemplateParser(path);

        return pathTemplate.matches(httpPath);

    });
}

router.use('/:systemId/:consumerInstanceId/:consumerResourceName', require('../middleware/stringBody'));

router.all('/:systemId/:consumerInstanceId/:consumerResourceName/:type/*', async (req, res) => {

    try {
        const plan = await assetManager.getPlan(req.params.systemId);

        // We can find the connection by the consumer information alone since
        // only 1 provider can be connected to a consumer resource at a time
        const connection = _.find(plan.spec.connections, (connection) => {
            return connection.to.blockId === req.params.consumerInstanceId &&
                connection.to.resourceName === req.params.consumerResourceName;
        });

        if (!connection) {
            res.status(401).send({error:`No connection found for consumer "${req.params.consumerInstanceId}::${req.params.consumerResourceName}"`});
            return;
        }

        const toBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
            return blockInstance.id === connection.to.blockId;
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

        const consumerMethodId = getRestMethodId(toResource, req.method, consumerPath);

        if (!consumerMethodId) {
            res.status(401).send({
                error:`Consumer method not found for path "${req.method} ${consumerPath}" in resource "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`
            });
            return;
        }

        const consumerMethod = toResource.spec.methods[consumerMethodId];


        const providerMethodId = _.findKey(connection.mapping, (mapping) => {
            return mapping.targetId === consumerMethodId;
        });

        if (!providerMethodId) {
            res.status(401).send({error:`Connection contained no mapping for consumer method "${consumerMethodId}`});
            return;
        }

        const fromBlockInstance = _.find(plan.spec.blocks, (blockInstance) => {
            return blockInstance.id === connection.from.blockId;
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

        const providerMethod = fromResource.spec.methods[providerMethodId];

        if (!providerMethod) {
            res.status(401).send({
                error:`Provider method not found "${providerMethodId}" in resource "${connection.from.blockId}::${connection.from.resourceName}`
            });
            return;
        }

        //Now we've resolved all the things involved in the connection - do the actual transformation

        const consumerPathTemplate = pathTemplateParser(consumerMethod.path);
        const providerPathTemplate = pathTemplateParser(providerMethod.path);

        const pathVariables = consumerPathTemplate.parse(consumerPath);

        let providerPath = providerPathTemplate.create(pathVariables);

        if (!providerPath.startsWith('/')) {
            providerPath = '/' + providerPath;
        }

        const headers = _.clone(req.headers);

        delete headers['content-length'];
        delete headers['content-encoding'];
        delete headers['connection'];
        delete headers['host'];
        delete headers['origin'];

        //Get target address
        let address = await serviceManager.getProviderAddress(
            req.params.systemId,
            connection.from.blockId,
            connection.from.resourceName,
            req.params.type
        );

        while(address.endsWith('/')) {
            address = address.substr(0, address.length - 1);
        }

        console.log('Route to provider: %s => %s', consumerPath, address + providerPath);

        const reqOpts = {
            method: providerMethod.method || 'GET',
            headers: req.headers,
            url: address + providerPath,
            body: req.stringBody
        };

        const traffic = networkManager.addRequest(
            req.params.systemId,
            connection,
            reqOpts,
            consumerMethodId,
            providerMethodId
        );

        socketManager.emit(traffic.connectionId, 'traffic_start', traffic);

        request(reqOpts, function(err, response, responseBody) {
            if (err) {
                traffic.asError(err);
                socketManager.emit(traffic.connectionId, 'traffic_end', traffic);

                res.status(500).send({error: '' + err});
                return;
            }

            const headers = _.clone(response.headers);

            delete headers['content-length'];
            delete headers['content-encoding'];
            delete headers['connection'];

            res.set(headers);

            res.status(response.statusCode);

            traffic.withResponse({
                code: response.statusCode,
                headers: response.headers,
                body: responseBody
            });

            socketManager.emit(traffic.connectionId, 'traffic_end', traffic);

            if (responseBody) {
                res.send(responseBody);
            } else {
                res.end();
            }
        });

    } catch(err) {
        console.log('Failed', err.stack);
        res.status(400).send({error: err.message});
    }

});

module.exports = router;