/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Router from 'express-promise-router';
import { Response } from 'express';

import { corsHandler } from '../middleware/cors';

import { stringBody, StringBodyRequest } from '../middleware/stringBody';
import { aiClient, AIRequest } from './aiClient';
import { KapetaBodyRequest } from '../types';
import YAML from 'yaml';

const router = Router();

router.use('/', corsHandler);
router.use('/', stringBody);

router.post('/prompt/:handle', async (req: KapetaBodyRequest, res: Response) => {
    const handle = req.params.handle;
    try {
        const aiRequest: AIRequest = JSON.parse(req.stringBody ?? '{}');
        const result = await aiClient.sendPrompt(handle, aiRequest);
        if (req.accepts('application/yaml')) {
            res.set('Content-Type', 'application/yaml');
            res.send(YAML.stringify(result));
        } else {
            res.json(result);
        }
    } catch (err: any) {
        console.error('Failed to send prompt', err);
        res.status(400).send({ error: err.message });
        return;
    }
});

export default router;
