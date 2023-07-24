import { NextFunction, Request, Response } from 'express';
import { EnvironmentType } from '../types';
import { parseKapetaUri } from '@kapeta/nodejs-utils';
import { normalizeKapetaUri } from '../utils/utils';

export interface KapetaRequest extends Request {
    kapeta?: {
        blockRef: string;
        instanceId: string;
        systemId: string;
        environment?: EnvironmentType;
    };
}

export function kapetaHeaders(req: KapetaRequest, res: Response, next: NextFunction) {
    let blockRef: string = req.headers['x-kapeta-block'] as string;
    let systemId: string = req.headers['x-kapeta-system'] as string;
    let instanceId: string = req.headers['x-kapeta-instance'] as string;
    let environment: string = req.headers['x-kapeta-environment'] as string;

    if (blockRef) {
        blockRef = normalizeKapetaUri(blockRef);
    }

    if (systemId) {
        systemId = normalizeKapetaUri(systemId);
    }

    req.kapeta = {
        blockRef,
        instanceId,
        systemId,
        environment: environment ? (environment as EnvironmentType) : undefined,
    };

    next();
}
