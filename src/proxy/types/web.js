const request = require('request');
const Path = require('path');
const _ = require('lodash');

const networkManager = require('../../networkManager');
const socketManager = require('../../socketManager');

/**
 *
 * @param req {Request}
 * @param res {Response}
 * @param opts {ProxyRequestInfo}
 */
module.exports = function proxyRestRequest(req, res, opts) {

    console.log('Route to provider: %s => %s', opts.consumerPath, opts.address);

    const requestHeaders = _.clone(req.headers);

    delete requestHeaders['content-length'];
    delete requestHeaders['content-encoding'];
    delete requestHeaders['connection'];
    delete requestHeaders['host'];
    delete requestHeaders['origin'];

    const sourceBasePath = opts.fromResource.spec.path;
    const targetBasePath = opts.toResource.spec.path;
    let path = opts.consumerPath;
    if (opts.consumerPath.startsWith(sourceBasePath)) {
        path = path.replace(sourceBasePath, targetBasePath);
    }


    const reqOpts = {
        method: req.method,
        url: opts.address + path,
        headers: requestHeaders,
        body: req.stringBody
    };

    console.log('reqOpts', reqOpts);

    const traffic = networkManager.addRequest(
        req.params.systemId,
        opts.connection,
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

        const responseHeaders = _.clone(response.headers);

        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        delete responseHeaders['connection'];

        res.set(responseHeaders);
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

};