import Router from 'express-promise-router';
import { providerManager } from '../providerManager';

import { corsHandler } from '../middleware/cors';
import { Request, Response } from 'express';

const router = Router();

router.use('/', corsHandler);

router.get('/', async (req: Request, res: Response) => {
    const result = await providerManager.getWebProviders();

    res.send(result);
});

router.get('/asset/:handle/:name/:version/web.js', async (req: Request, res: Response) => {
    const { handle, name, version } = req.params;
    let result = await providerManager.getProviderWebJS(handle, name, version);

    if (!result) {
        res.status(404).send('');
    } else {
        if (version !== 'local') {
            res.setHeader('Cache-Control', 'max-age=31536000, immutable');
        }
        res.send(result.toString().replace(`${name}.js.map`, 'web.js.map'));
    }
});

router.get('/asset/:handle/:name/:version/web.js.map', async (req: Request, res: Response) => {
    const { handle, name, version } = req.params;
    const result = await providerManager.getProviderWebJS(handle, name, version, true);

    if (!result) {
        res.status(404).send('');
    } else {
        // Only cache successful requests
        if (version !== 'local') {
            res.setHeader('Cache-Control', 'max-age=31536000, immutable');
        }
        res.send(result);
    }
});

export default router;
