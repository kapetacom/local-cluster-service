/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Router from 'express-promise-router';
import { corsHandler } from './middleware/cors';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
import { Config } from '@kapeta/nodejs-registry-utils';
const { createAPIRoute } = require('@kapeta/web-microfrontend/server');
const packageJson = require('../package.json');

const router = Router();

router.use('/', corsHandler);

router.use(
    '/registry',
    createAPIRoute(Config.data?.registry?.url ?? 'https://registry.kapeta.com', {
        nonce: false,
        userAgent: `KapetaDesktopCluster/${packageJson.version}`,
        tokenFetcher: () => {
            const api = new KapetaAPI();
            if (api.hasToken()) {
                return api.getAccessToken();
            }
            return null;
        },
    })
);

export default router;
