/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import request from 'request';
import _ from 'lodash';
import { networkManager } from '../../networkManager';
import { socketManager } from '../../socketManager';
import { Request, Response } from 'express';
import { ProxyRequestInfo, SimpleRequest, StringMap } from '../../types';
import { StringBodyRequest } from '../../middleware/stringBody';

export function proxyHttpRequest(req: StringBodyRequest, res: Response, opts: ProxyRequestInfo) {
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

    console.log('Proxy request to provider: %s => %s%s [http]', opts.consumerPath, opts.address, path);

    const reqOpts: SimpleRequest = {
        method: req.method,
        url: opts.address + path,
        headers: requestHeaders as StringMap,
        body: req.stringBody,
    };

    const traffic = networkManager.addRequest(req.params.systemId, opts.connection, reqOpts);

    socketManager.emit(traffic.connectionId, 'traffic_start', traffic);
    const proxyReq = request(reqOpts);

    proxyReq.on('error', function (err) {
        traffic.asError(err);
        socketManager.emit(traffic.connectionId, 'traffic_end', traffic);
        if (!res.headersSent) {
            res.status(500).send({ error: '' + err });
        }
    });

    proxyReq.on('response', function (response) {
        //TODO: Include the response body in the traffic object when it is not a stream
        traffic.withResponse({
            code: response.statusCode,
            headers: response.headers as StringMap,
            body: null,
        });

        socketManager.emit(traffic.connectionId, 'traffic_end', traffic);
    });

    //We need to pipe the proxy response to the client response to handle sockets and event streams
    proxyReq.pipe(res);
}
