import Router from 'express-promise-router';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

import { corsHandler } from '../middleware/cors';
import { Request, Response } from 'express';
import {storageService} from "../storageService";

const router = Router();
const api = new KapetaAPI();

const DEFAULT_REGISTRY_BASE = 'https://registry.kapeta.com';

function getBaseUrl() {
    const endpoint = storageService.get('endpoints', 'registry', DEFAULT_REGISTRY_BASE);
    return `${endpoint}/v1/registry`;
}

router.use('/', corsHandler);

router.put('/:handle/:name', async (req: Request, res: Response) => {
    const endpoint = getBaseUrl();
    if (!req.headers['content-type']) {
        res.status(400).send({
            status: 400,
            error: 'Missing content-type header'
        });
        return;
    }

    if (!req.headers['content-length']) {
        res.status(400).send({
            status: 400,
            error: 'Missing content-length header'
        });
        return;
    }

    if (!req.headers['content-disposition']) {
        res.status(400).send({
            status: 400,
            error: 'Missing content-disposition header'
        });
        return;
    }

    try {
        const {handle, name} = req.params;
        const url = `${endpoint}/${handle}/${name}/attachments`;
        const result = await api.send<{url:string}>({
            method: 'PUT',
            url,
            auth: true,
            headers: {
                'content-type': req.headers['content-type'],
                'content-length': req.headers['content-length'],
                'content-disposition': req.headers['content-disposition'],
            },
            body: req
        });
        res.send(result);
    } catch (e:any) {
        res.status(e.status ?? 500).send(e);
    }
});

export default router;
