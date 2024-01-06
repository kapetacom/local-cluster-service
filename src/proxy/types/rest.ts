/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import _ from 'lodash';
import request from 'request';
import Path from 'path';
import { pathTemplateParser } from '../../utils/pathTemplateParser';
import { networkManager } from '../../networkManager';

import { socketManager } from '../../socketManager';
import { Request, Response } from 'express';
import { ProxyRequestInfo, SimpleRequest, StringMap } from '../../types';
import { StringBodyRequest } from '../../middleware/stringBody';
import { Resource } from '@kapeta/schemas';

export function getRestMethodId(restResource: Resource, httpMethod: string, httpPath: string) {
    return _.findKey(restResource.spec.methods, (method) => {
        let methodType = method.method ? method.method.toUpperCase() : 'GET';

        if (methodType.toUpperCase() !== httpMethod.toUpperCase()) {
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
function resolveMethods(req: Request, opts: ProxyRequestInfo) {
    const consumerMethodId = getRestMethodId(opts.consumerResource, req.method, opts.consumerPath);

    if (!consumerMethodId) {
        throw new Error(
            `Consumer method not found for path "${req.method} ${opts.consumerPath}" in resource "${req.params.consumerInstanceId}::${req.params.consumerResourceName}`
        );
    }

    const consumerMethod = _.cloneDeep(opts.consumerResource.spec.methods[consumerMethodId]);

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

    const providerMethod = _.cloneDeep(opts.providerResource.spec.methods[providerMethodId]);

    if (!providerMethod) {
        throw new Error(
            `Provider method not found "${providerMethodId}" in resource "${opts.connection.provider.blockId}::${opts.connection.provider.resourceName}`
        );
    }

    providerMethod.id = providerMethodId;

    return {
        consumerMethod,
        providerMethod,
    };
}

export function proxyRestRequest(req: StringBodyRequest, res: Response, opts: ProxyRequestInfo) {
    let { consumerMethod, providerMethod } = resolveMethods(req, opts);

    const consumerPathTemplate = pathTemplateParser(consumerMethod.path);
    const providerPathTemplate = pathTemplateParser(providerMethod.path);

    const pathVariables = consumerPathTemplate.parse(opts.consumerPath);
    if (!pathVariables) {
        res.status(400).send({
            error: `Path did not match any patterns: "${opts.consumerPath}"`,
        });
        return;
    }

    let providerPath = providerPathTemplate.create(pathVariables);

    if (!providerPath.startsWith('/')) {
        providerPath = '/' + providerPath;
    }

    if (!_.isEmpty(req.query)) {
        providerPath += '?' + new URLSearchParams(req.query as any).toString();
    }

    const requestHeaders = _.clone(req.headers);

    delete requestHeaders['content-length'];
    delete requestHeaders['content-encoding'];
    delete requestHeaders['connection'];
    delete requestHeaders['host'];
    delete requestHeaders['origin'];

    console.log('Proxy request to provider: %s => %s [rest]', opts.consumerPath, opts.address + providerPath);

    const reqOpts: SimpleRequest = {
        method: providerMethod.method || 'GET',
        url: opts.address + providerPath,
        body: req.stringBody,
        headers: requestHeaders as StringMap,
    };

    const traffic = networkManager.addRequest(
        req.params.systemId,
        opts.connection,
        reqOpts,
        consumerMethod.id,
        providerMethod.id
    );

    socketManager.emit(traffic.connectionId, 'traffic_start', traffic);

    request(reqOpts, function (err, response, responseBody) {
        if (err) {
            traffic.asError(err);
            socketManager.emit(traffic.connectionId, 'traffic_end', traffic);

            res.status(500).send({ error: '' + err });
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
            headers: response.headers as StringMap,
            body: responseBody,
        });

        socketManager.emit(traffic.connectionId, 'traffic_end', traffic);

        if (responseBody) {
            res.write(responseBody);
        }

        res.end();
    });
}
