const {Router} = require('express');
const request = require('request');
const _ = require('lodash');

const router = new Router();
const networkManager = require('../networkManager');
const serviceManager = require('../serviceManager');
const clusterService = require('../clusterService');
const assetManager = require('../assetManager');
const socketManager = require('../socketManager');

router.use('/:systemId/:blockInstanceId/:resourceName/', require('../middleware/stringBody'));

router.all('/:systemId/:blockInstanceId/:resourceName/:type/*', async (req, res) => {

    let plan = null;
    try {
        plan = await assetManager.getPlan(req.params.systemId);
    } catch(err) {
        res.status(400).send({error: err.message});
        return;
    }

    const connection = _.find(plan.spec.connections, (connection) => {
        return connection.to.blockId === req.params.blockInstanceId &&
            connection.to.resourceName === req.params.resourceName;
    });

    if (!connection) {
        res.status(401).send({error:`No connection found for block "${req.params.blockInstanceId}" and resource "${req.params.resourceName}"`});
        return;
    }

    //Get service YAML config
    const address = await serviceManager.getProviderAddress(
        req.params.systemId,
        connection.from.blockId,
        connection.from.resourceName,
        req.params.type
    );

    const basePath = clusterService.getProxyPath(
        req.params.systemId,
        req.params.blockInstanceId,
        req.params.resourceName,
        req.params.type
    );

    const relativePath = req.originalUrl.substr(basePath.length);

    console.log('Route to service', connection.from, address, req.params.type, basePath, req.originalUrl, relativePath);

    const headers = _.clone(req.headers);

    delete headers['content-length'];
    delete headers['content-encoding'];
    delete headers['connection'];

    const reqOpts = {
        method: req.method,
        headers: req.headers,
        url: address + relativePath,
        body: req.stringBody
    };

    const traffic = networkManager.addRequest(
        req.params.systemId,
        connection,
        reqOpts
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

});

module.exports = router;