import Router from 'express-promise-router';
import {corsHandler} from "./middleware/cors";
import {KapetaAPI} from "@kapeta/nodejs-api-client";
import ClusterConfiguration from '@kapeta/local-cluster-config';
const { createAPIRoute }  = require('@kapeta/web-microfrontend/server');
const packageJson = require('../package.json');

const router = Router();

const remoteServices = ClusterConfiguration.getClusterConfig().remoteServices ?? {};
router.use('/', corsHandler)

router.use('/registry', createAPIRoute(remoteServices.registry ?? 'https://registry.kapeta.com', {
    nonce: false,
    userAgent: `KapetaDesktopCluster/${packageJson.version}`,
    tokenFetcher: () => {
        return new KapetaAPI().getAccessToken();
    }
}));

export default router;
