/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-misused-promises */
import Router from 'express-promise-router';
import { createProxyMiddleware, fixRequestBody, responseInterceptor } from 'http-proxy-middleware';
import { KapetaAPI } from '@kapeta/nodejs-api-client';
const api = new KapetaAPI();

// Iterate
const router = Router();

router.use(async (req, _res, next) => {
    (req as any).token = await api.getAccessToken();
    next();
});

const backends = {
    web: 'https://web.kapeta.com/',
    deployments: 'https://web-deployments.kapeta.com/',
    registry: 'https://web-registry.kapeta.com/',
};

Object.entries(backends).forEach(([name, target]) => {
    router.use(
        `/${name}/*`,
        createProxyMiddleware({
            target,
            changeOrigin: true,
            onProxyReq: (proxyReq, req, _res) => {
                fixRequestBody(proxyReq, req);

                const token = (req as any).token as string;
                if (token) {
                    // Doesn't seem we actually support passing it as a header, but for future reference
                    proxyReq.setHeader('Authorization', `Bearer ${token}`);

                    // This is the only way to pass the token to the backend
                    const url = new URL(proxyReq.path, 'http://localhost/');
                    url.searchParams.set('token', token);
                    proxyReq.path = url.pathname + url.search;
                }
            },
        })
    );
});

export default router;
