const request = require('request');
const Path = require('path');
const _ = require('lodash');

const pathTemplateParser = require('../../utils/pathTemplateParser');
const networkManager = require('../../networkManager');
const socketManager = require('../../socketManager');


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

/**
 *
 * @param req {Request}
 * @param opts {ProxyRequestInfo}
 * @return {{consumerMethod: *, providerMethod: *}}
 */
function resolveMethods(req, opts) {
    const consumerMethodId = getRestMethodId(opts.toResource, req.method, opts.consumerPath);

    if (!consumerMethodId) {
        throw new Error(
            `Consumer method not found for path "${req.method} ${opts.consumerPath}" in resource "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`
        );
    }

    const consumerMethod = _.cloneDeep(opts.toResource.spec.methods[consumerMethodId]);

    if (!consumerMethod) {
        throw new Error(
            `Consumer method not found for path "${req.method} ${opts.consumerPath}" in resource "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`
        );
    }

    consumerMethod.id = consumerMethodId;

    const providerMethodId = _.findKey(opts.connection.mapping, (mapping) => {
        return mapping.targetId === consumerMethodId;
    });

    if (!providerMethodId) {
        throw new Error(`Connection contained no mapping for consumer method "${consumerMethodId}`);
    }

    const providerMethod = _.cloneDeep(opts.fromResource.spec.methods[providerMethodId]);

    if (!providerMethod) {
        throw new Error(
            `Provider method not found "${providerMethodId}" in resource "${opts.connection.from.blockId}::${opts.connection.from.resourceName}`
        );
    }

    providerMethod.id = providerMethodId;

    return {
        consumerMethod,
        providerMethod
    };
}

/**
 *
 * @param req {Request}
 * @param res {Response}
 * @param opts {ProxyRequestInfo}
 */
module.exports = function proxyRestRequest(req, res, opts) {

    let {consumerMethod, providerMethod} = resolveMethods(req, opts);

    const consumerPathTemplate = pathTemplateParser(consumerMethod.path);
    const providerPathTemplate = pathTemplateParser(providerMethod.path);

    const pathVariables = consumerPathTemplate.parse(opts.consumerPath);

    let providerPath = providerPathTemplate.create(pathVariables);

    if (!providerPath.startsWith('/')) {
        providerPath = '/' + providerPath;
    }

    const requestHeaders = _.clone(req.headers);

    delete requestHeaders['content-length'];
    delete requestHeaders['content-encoding'];
    delete requestHeaders['connection'];
    delete requestHeaders['host'];
    delete requestHeaders['origin'];


    console.log('Route to provider: %s => %s', opts.consumerPath, opts.address + providerPath);

    const reqOpts = {
        method: providerMethod.method || 'GET',
        url: opts.address + providerPath,
        body: req.stringBody,
        headers: requestHeaders
    };

    const traffic = networkManager.addRequest(
        req.params.systemId,
        opts.connection,
        reqOpts,
        consumerMethod.id,
        providerMethod.id
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