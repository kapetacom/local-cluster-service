import { Request, Response } from 'express';
import Router from 'express-promise-router';
import { KapetaAPI } from '@kapeta/nodejs-api-client';

import { corsHandler } from '../middleware/cors.js';

const router = Router();
const api = new KapetaAPI();

router.use('/', corsHandler);

router.get('/current', async (req: Request, res: Response) => {
    res.send(await api.getCurrentIdentity());
});

router.get('/:identityId/memberships', async (req: Request, res: Response) => {
    res.send(await api.getMemberships(req.params.identityId));
});

export default router;
