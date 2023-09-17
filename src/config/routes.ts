import Router from 'express-promise-router';
import { configManager, SYSTEM_ID } from '../configManager';
import { serviceManager } from '../serviceManager';
import { operatorManager } from '../operatorManager';
import { instanceManager } from '../instanceManager';
import { corsHandler } from '../middleware/cors';
import { kapetaHeaders, KapetaRequest } from '../middleware/kapeta';
import { stringBody } from '../middleware/stringBody';
import { AnyMap, KapetaBodyRequest } from '../types';
import { Response } from 'express';

const router = Router();

router.use('/', corsHandler);
router.use('/', kapetaHeaders);
router.use('/', stringBody);

/**
 * Returns the full configuration for a given service.
 */
router.get('/instance', async (req: KapetaBodyRequest, res: Response) => {
    try {
        let config: AnyMap = {};
        if (req.kapeta!.instanceId) {
            config = await configManager.getConfigForBlockInstance(req.kapeta!.systemId, req.kapeta!.instanceId);
        } else {
            config = configManager.getConfigForSystem(req.kapeta!.systemId);
        }

        res.send(config);
    } catch (err: any) {
        console.error('Failed to get instance config', err);
        res.status(400).send({ error: err.message });
        return;
    }
});

/**
 * Updates the full configuration for a given service.
 */
router.put('/instance', async (req: KapetaBodyRequest, res) => {
    try {
        let config = JSON.parse(req.stringBody ?? '{}');
        if (!config) {
            config = {};
        }

        if (req.kapeta!.instanceId) {
            configManager.setConfigForSection(req.kapeta!.systemId, req.kapeta!.instanceId, config);
            //Restart the instance if it is running after config change
            await instanceManager.prepareForRestart(req.kapeta!.systemId, req.kapeta!.instanceId);
        } else {
            configManager.setConfigForSystem(req.kapeta!.systemId, config);
        }
    } catch (err: any) {
        console.error('Failed to update instance config', err);
        res.status(400).send({ error: err.message });
        return;
    }

    res.status(202).send({ ok: true });
});

/**
 * Returns the full configuration for a plan
 */
router.get('/system', (req: KapetaRequest, res) => {
    const config = configManager.getConfigForSection(req.kapeta!.systemId, SYSTEM_ID);

    res.send(config);
});

/**
 * Updates the full configuration for a plan
 */
router.put('/system', (req: KapetaBodyRequest, res) => {
    let config = JSON.parse(req.stringBody ?? '{}');
    if (!config) {
        config = {};
    }
    configManager.setConfigForSection(req.kapeta!.systemId, SYSTEM_ID, config);
    res.status(202).send({ ok: true });
});

/**
 * Resolves and checks the identity of a block instance
 */
router.get('/identity', async (req: KapetaRequest, res) => {
    const identity = {
        systemId: req.kapeta!.systemId,
        instanceId: req.kapeta!.instanceId,
    };

    if (!req.kapeta!.blockRef) {
        res.status(400).send({ error: 'Missing required header "X-Kapeta-Block"' });
        return;
    }

    try {
        if (!identity.systemId || !identity.instanceId) {
            const { systemId, instanceId } = await configManager.resolveIdentity(
                req.kapeta!.blockRef,
                identity.systemId
            );
            identity.systemId = systemId;
            identity.instanceId = instanceId;
        } else {
            await configManager.verifyIdentity(req.kapeta!.blockRef, identity.systemId, identity.instanceId);
        }

        res.send(identity);
    } catch (err: any) {
        console.warn('Failed to resolve identity', err);
        res.status(400).send({ error: err.message });
    }
});

/**
 * Services call this to request a free port. If a service has
 * already called the endpoint the same port is returned.
 */
router.get('/provides/:type', async (req: KapetaRequest, res) => {
    if (req.kapeta!.environment === 'docker' && ['web', 'rest'].includes(req.params.type)) {
        // Happens when starting a local container with no providers.
        res.send('80');
        return;
    }

    try {
        const port = await serviceManager.ensureServicePort(
            req.kapeta!.systemId,
            req.kapeta!.instanceId,
            req.params.type
        );
        res.send('' + port);
    } catch (err: any) {
        console.warn('Failed to resolve service port: ' + req.params.type, err);
        res.status(400).send({ error: err.message });
    }
});

/**
 * Used by services to get info for consumed operator resource.
 *
 * If the operator resource is not already available this will cause it to start an instance and
 * assign port numbers to it etc.
 */
router.get('/consumes/resource/:resourceType/:portType/:name', async (req: KapetaRequest, res) => {
    const operatorInfo = await operatorManager.getConsumerResourceInfo(
        req.kapeta!.systemId,
        req.kapeta!.instanceId,
        req.params.resourceType,
        req.params.portType,
        req.params.name,
        req.kapeta!.environment
    );

    res.send(operatorInfo);
});

/**
 * Used by services to get address for their clients.
 *
 * If the remote service is not already registered with a port - we do that here
 * to handle clients for services that hasn't started yet.
 */
router.get('/consumes/:resourceName/:type', (req: KapetaRequest, res) => {
    res.send(
        serviceManager.getConsumerAddress(
            req.kapeta!.systemId,
            req.kapeta!.instanceId,
            req.params.resourceName,
            req.params.type,
            req.kapeta!.environment
        )
    );
});

export default router;
