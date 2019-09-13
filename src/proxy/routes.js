const {Router} = require('express');
const request = require('request');
const _ = require('lodash');

const router = new Router();
const networkManager = require('../networkManager');
const serviceManager = require('../serviceManager');
const clusterService = require('../clusterService');

router.use('/:systemId', (req, res, next) => {
    req.blockware = {
        systemId: req.params.systemId
    };
});

router.use('/:systemId/:fromServiceId/:toServiceId/', require('../middleware/stringBody'));

router.all('/:systemId/:fromServiceId/:toServiceId/:type/*', async (req, res) => {
    //Get service YAML config
    const address = await serviceManager.getProviderAddress(
        req.blockware.systemId,
        req.params.toServiceId,
        req.params.type
    );

    const basePath = clusterService.getProxyPath(
        req.blockware.systemId,
        req.params.fromServiceId,
        req.params.toServiceId,
        req.params.type
    );

    const relativePath = req.path.substr(basePath.length);

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
        req.blockware.systemId,
        req.params.fromServiceId,
        req.params.toServiceId,
        reqOpts
    );

    request(reqOpts, function(err, response, responseBody) {
        if (err) {
            traffic.asError(err);
            res.send(500, 'ERR: ' + err);
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

        if (responseBody) {
            res.send(responseBody);
        } else {
            res.end();
        }
    });

});

module.exports = router;