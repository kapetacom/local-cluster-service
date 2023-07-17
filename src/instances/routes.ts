import { NextFunction, Request, Response } from 'express';
import Router from 'express-promise-router';
import { instanceManager } from '../instanceManager.js';
import { serviceManager } from '../serviceManager.js';
import { corsHandler } from '../middleware/cors.js';
import { kapetaHeaders, KapetaRequest } from '../middleware/kapeta.js';
import { stringBody } from '../middleware/stringBody.js';
import { KapetaBodyRequest } from '../types.js';

const router = Router();
router.use('/', corsHandler);
router.use('/', kapetaHeaders);
/**
 * Get all instances
 */
router.get('/', (req: Request, res: Response) => {
    res.send(instanceManager.getInstances());
});

/**
 * Get all instances
 */
router.get('/:systemId/instances', (req: Request, res: Response) => {
    res.send(instanceManager.getInstancesForPlan(req.params.systemId));
});

/**
 * Start all instances in a plan
 */
router.post('/:systemId/start', async (req: Request, res: Response) => {
    const processes = await instanceManager.createProcessesForPlan(req.params.systemId);

    res.status(202).send({
        ok: true,
        processes: processes.map((p) => {
            return { pid: p.pid, type: p.type };
        }),
    });
});

/**
 * Stop all instances in plan
 */
router.post('/:systemId/stop', async (req: Request, res: Response) => {
    await instanceManager.stopAllForPlan(req.params.systemId);

    res.status(202).send({
        ok: true,
    });
});

/**
 * Start single instance in a plan
 */
router.post('/:systemId/:instanceId/start', async (req: Request, res: Response) => {
    const process = await instanceManager.createProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({
        ok: true,
        pid: process.pid,
        type: process.type,
    });
});

/**
 * Stop single instance in a plan
 */
router.post('/:systemId/:instanceId/stop', async (req: Request, res: Response) => {
    await instanceManager.stopProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({ ok: true });
});

/**
 * Get logs for instance in a plan
 */
router.get('/:systemId/:instanceId/logs', (req: Request, res: Response) => {
    const processInfo = instanceManager.getProcessForInstance(req.params.systemId, req.params.instanceId);
    if (!processInfo) {
        res.status(404).send({ ok: false });
        return;
    }

    res.status(202).send({
        logs: processInfo.logs(),
    });
});

/**
 * Get public address for instance in a plan if available
 */
router.get('/:systemId/:instanceId/address/public', (req: Request, res: Response) => {
    const instance = instanceManager.getInstance(req.params.systemId, req.params.instanceId);
    if (!instance) {
        res.status(404).send({ ok: false });
        return;
    }

    if (!instance.address) {
        res.status(400).send({ error: `Instance does not have an address. Make sure it's running.` });
        return;
    }

    res.status(200).send(instance.address);
});

/**
 * Get public address for particular resource on instance in a plan if available
 */
router.get(
    '/:systemId/:instanceId/provider/:portType/:resourceName/address/public',
    (req: KapetaRequest, res: Response) => {
        res.send(
            serviceManager.getConsumerAddress(
                req.params.systemId,
                req.params.instanceId,
                req.params.resourceName,
                req.params.portType,
                req.kapeta?.environment
            )
        );
    }
);

router.use('/', stringBody);
router.use('/', (req: KapetaBodyRequest, res: Response, next: NextFunction) => {
    if (!req.kapeta!.blockRef) {
        res.status(400).send({ error: 'Missing X-Kapeta-Block header.' });
        return;
    }
    next();
});

/**
 * Updates the full configuration for a given service.
 */
router.put('/', async (req: KapetaBodyRequest, res: Response) => {
    let instance = req.stringBody ? JSON.parse(req.stringBody) : null;
    if (req.kapeta!.environment === 'docker') {
        //A bit hacky but we want to avoid overwriting the docker PID with a process PID
        const oldInstance = instanceManager.getInstance(req.kapeta!.systemId, req.kapeta!.instanceId);
        if (oldInstance) {
            instance.pid = oldInstance.pid;
        }
        instance.type = 'docker';
    } else if (req.kapeta!.environment === 'process') {
        instance.type = 'process';
    }

    await instanceManager.registerInstance(req.kapeta!.systemId, req.kapeta!.instanceId, instance);

    res.status(202).send({ ok: true });
});

/**
 * Delete instance
 */
router.delete('/', async (req: KapetaRequest, res: Response) => {
    await instanceManager.setInstanceAsStopped(req.kapeta!.systemId, req.kapeta!.instanceId);

    res.status(202).send({ ok: true });
});

export default router;
