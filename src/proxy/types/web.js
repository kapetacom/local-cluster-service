const request = require('request');
const _ = require('lodash');

const networkManager = require('../../networkManager');
const socketManager = require('../../socketManager');

/**
 *
 * @param req {Request}
 * @param res {Response}
 * @param opts {ProxyRequestInfo}
 */
module.exports = function proxyWebRequest(req, res, opts) {

    const requestHeaders = _.clone(req.headers);

    delete requestHeaders['content-length'];
    delete requestHeaders['content-encoding'];
    delete requestHeaders['connection'];
    delete requestHeaders['host'];
    delete requestHeaders['origin'];

    const sourceBasePath = opts.consumerResource.spec.path;
    const targetBasePath = opts.providerResource.spec.path;
    let path = opts.consumerPath;
    if (opts.consumerPath.startsWith(sourceBasePath)) {
        path = path.replace(sourceBasePath, targetBasePath);
    }

    console.log('Proxy request to provider: %s => %s%s [web]', opts.consumerPath, opts.address, path);

    const reqOpts = {
        method: req.method,
        url: opts.address + path,
        headers: requestHeaders,
        body: req.stringBody
    };

    const traffic = networkManager.addRequest(
        req.params.systemId,
        opts.connection,
        reqOpts
    );

    socketManager.emit(traffic.connectionId, 'traffic_start', traffic);
    const proxyReq = request(reqOpts);

    proxyReq.on('error', function(err) {
        traffic.asError(err);
        socketManager.emit(traffic.connectionId, 'traffic_end', traffic);
        if (!res.headersSent) {
            res.status(500).send({error: '' + err});
        }
    });

    proxyReq.on('response', function(response) {
        //TODO: Include the response body in the traffic object when it is not a stream
        traffic.withResponse({
            code: response.statusCode,
            headers: response.headers
        });

        socketManager.emit(traffic.connectionId, 'traffic_end', traffic);
    });

    //We need to pipe the proxy response to the client response to handle sockets and event streams
    proxyReq.pipe(res);
};