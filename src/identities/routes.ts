import Router from 'express-promise-router';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

import { corsHandler } from '../middleware/cors';
import { Request, Response } from 'express';

const router = Router();
const api = new KapetaAPI();

router.use('/', corsHandler);

router.get('/current', async (req: Request, res: Response) => {
    try {
        res.send(await api.getCurrentIdentity());
    } catch (e: any) {
        res.status(e.status ?? 500).send(e);
    }
});

router.get('/:identityId/memberships', async (req: Request, res: Response) => {
    try {
        res.send(await api.getMemberships(req.params.identityId));
    } catch (e: any) {
        res.status(e.status ?? 500).send(e);
    }
});

export default router;
