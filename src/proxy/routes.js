const {Router} = require('express');
const request = require('request');
const _ = require('lodash');

const router = new Router();
const networkManager = require('../networkManager');
const serviceManager = require('../serviceManager');
const clusterService = require('../clusterService');

router.use('/:fromService/:toService/', (req, res, next) => {
    // push the data to body
    var body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        req.body = Buffer.concat(body).toString();
        next();
    });
});

router.all('/:fromService/:toService/:type/*', async (req, res) => {
    //Get service YAML config
    const address = await serviceManager.getProviderAddress(req.params.toService, req.params.type);

    const basePath = clusterService.getProxyPath(req.params.fromService, req.params.toService, req.params.type);
    const relativePath = req.path.substr(basePath.length);

    const headers = _.clone(req.headers);

    delete headers['content-length'];
    delete headers['content-encoding'];
    delete headers['connection'];

    const reqOpts = {
        method: req.method,
        headers: req.headers,
        url: address + relativePath,
        body: req.body
    };

    const traffic = networkManager.addRequest(
        req.params.fromService,
        req.params.toService,
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