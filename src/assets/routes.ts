import Router from 'express-promise-router';
import { Request, Response } from 'express';
import YAML from 'yaml';
import { assetManager } from '../assetManager.js';

import { corsHandler } from '../middleware/cors.js';

import { stringBody, StringBodyRequest } from '../middleware/stringBody.js';

function parseBody(req: StringBodyRequest) {
    switch (req.headers['content-type']) {
        case 'application/json':
        case 'application/x-json':
        case 'text/json':
            return JSON.parse(req.stringBody ?? '{}');

        case 'application/yaml':
        case 'application/x-yaml':
        case 'text/yaml':
        case 'text/x-yaml':
        default:
            return YAML.parse(req.stringBody ?? '{}');
    }
}

const router = Router();

router.use('/', corsHandler);
router.use('/', stringBody);

/**
 * Get all local assets available
 */
router.get('/', (req: Request, res: Response) => {
    res.send(assetManager.getAssets());
});

/**
 * Get single asset
 */
router.get('/read', async (req: Request, res: Response) => {
    if (!req.query.ref) {
        res.status(400).send({ error: 'Query parameter "ref" is missing' });
        return;
    }

    try {
        res.send(await assetManager.getAsset(req.query.ref as string, true));
    } catch (err: any) {
        res.status(400).send({ error: err.message });
    }
});

/**
 * Creates a new local file and registers it as an asset
 */
router.post('/create', async (req: Request, res: Response) => {
    if (!req.query.path) {
        res.status(400).send({ error: 'Query parameter "path" is missing' });
        return;
    }

    const content = parseBody(req);

    try {
        const assets = await assetManager.createAsset(req.query.path as string, content);

        res.status(200).send(assets);
    } catch (err: any) {
        console.log('Failed while creating asset', req.query.path, err.message);
        res.status(400).send({ error: err.message });
    }
});

/**
 * Updates reference with new content
 */
router.put('/update', async (req: Request, res: Response) => {
    if (!req.query.ref) {
        res.status(400).send({ error: 'Query parameter "ref" is missing' });
        return;
    }

    const content = parseBody(req);

    try {
        await assetManager.updateAsset(req.query.ref as string, content);

        res.sendStatus(204);
    } catch (err: any) {
        console.log('Failed while updating asset', req.query.ref, err.message);
        res.status(400).send({ error: err.message });
    }
});

/**
 * Unregisters an asset (doesn't delete the asset)
 */
router.delete('/', async (req: Request, res: Response) => {
    if (!req.query.ref) {
        res.status(400).send({ error: 'Query parameter "ref" is missing' });
        return;
    }

    try {
        await assetManager.unregisterAsset(req.query.ref as string);

        res.status(204).send();
    } catch (err: any) {
        res.status(400).send({ error: err.message });
    }
});

/**
 * Registers an existing file as an asset
 */
router.put('/import', async (req: Request, res: Response) => {
    if (!req.query.ref) {
        res.status(400).send({ error: 'Query parameter "ref" is missing' });
        return;
    }

    try {
        const assets = await assetManager.importFile(req.query.ref as string);

        res.status(200).send(assets);
    } catch (err: any) {
        res.status(400).send({ error: err.message });
    }
});

export default router;
