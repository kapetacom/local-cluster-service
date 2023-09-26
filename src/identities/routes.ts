import Router from 'express-promise-router';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

import { corsHandler } from '../middleware/cors';
import { Request, Response } from 'express';

const router = Router();

router.use('/', corsHandler);

router.get('/current', async (req: Request, res: Response) => {
    const api = new KapetaAPI();
    if (api.hasToken()) {
        try {
            res.json(await api.getCurrentIdentity());
            return;
        } catch (e) {
            console.error(e);
        }
    }
    res.status(200).json(null);
});

router.get('/:identityId/memberships', async (req: Request, res: Response) => {
    const api = new KapetaAPI();
    if (api.hasToken()) {
        res.send(await api.getMemberships(req.params.identityId));
    } else {
        res.send([]);
    }
});

export default router;
