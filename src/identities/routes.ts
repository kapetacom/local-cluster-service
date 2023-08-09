import Router from 'express-promise-router';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

import { corsHandler } from '../middleware/cors';
import { Request, Response } from 'express';

const router = Router();
const api = new KapetaAPI();

router.use('/', corsHandler);

router.get('/current', async (req: Request, res: Response) => {
    try {
        if (api.hasToken()) {
            res.send(await api.getCurrentIdentity());
        } else {
            res.status(404).send();
        }
    } catch (e: any) {
        res.status(e.status ?? 500).send(e);
    }
});

router.get('/:identityId/memberships', async (req: Request, res: Response) => {
    try {
        if (api.hasToken()) {
            res.send(await api.getMemberships(req.params.identityId));
        } else {
            res.send([]);
        }
    } catch (e: any) {
        res.status(e.status ?? 500).send(e);
    }
});

export default router;
