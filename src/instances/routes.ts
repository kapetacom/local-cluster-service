import Router from 'express-promise-router';
import { instanceManager } from '../instanceManager';
import { serviceManager } from '../serviceManager';
import { corsHandler } from '../middleware/cors';
import { NextFunction, Request, Response } from 'express';
import { kapetaHeaders, KapetaRequest } from '../middleware/kapeta';
import { stringBody } from '../middleware/stringBody';
import { DesiredInstanceStatus, InstanceInfo, InstanceOwner, InstanceType, KapetaBodyRequest } from '../types';
import { Task } from '../taskManager';

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

router.get('/:systemId/instances/:instanceId', (req: Request, res: Response) => {
    res.send(instanceManager.getInstance(req.params.systemId, req.params.instanceId));
});

/**
 * Start all instances in a plan
 */
router.post('/:systemId/start', async (req: Request, res: Response) => {
    const task = await instanceManager.startAllForPlan(req.params.systemId);

    res.status(202).send({
        ok: true,
        taskId: task.id,
    });
});

/**
 * Stop all instances in plan
 */
router.post('/:systemId/stop', async (req: Request, res: Response) => {
    const task = instanceManager.stopAllForPlan(req.params.systemId);

    res.status(202).send({
        ok: true,
        taskId: task.id,
    });
});

/**
 * Start single instance in a plan
 */
router.post('/:systemId/:instanceId/start', async (req: Request, res: Response) => {
    const result = await instanceManager.start(req.params.systemId, req.params.instanceId);
    if (result instanceof Task) {
        res.status(202).send({
            ok: true,
            taskId: result.id,
        });
    } else {
        res.status(202).send({
            ok: true,
            pid: result.pid,
            type: result.type,
        });
    }
});

/**
 * Stop single instance in a plan
 */
router.post('/:systemId/:instanceId/stop', async (req: Request, res: Response) => {
    await instanceManager.stop(req.params.systemId, req.params.instanceId);

    res.status(202).send({ ok: true });
});

/**
 * Get logs for instance in a plan
 */
router.get('/:systemId/:instanceId/logs', async (req: Request, res: Response) => {
    const instanceInfo = instanceManager.getInstance(req.params.systemId, req.params.instanceId);
    if (!instanceInfo) {
        res.status(404).send({ ok: false });
        return;
    }

    try {
        const logs = await instanceManager.getLogs(req.params.systemId, req.params.instanceId);
        res.status(200).send({
            logs,
        });
    } catch (e: any) {
        res.status(500).send({ ok: false, error: e.message });
    }
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
 * Updates the full configuration for a given instance.
 */
router.put('/', async (req: KapetaBodyRequest, res: Response) => {
    let instance: InstanceInfo = req.stringBody ? JSON.parse(req.stringBody) : null;
    if (req.kapeta!.environment === 'docker') {
        //A bit hacky but we want to avoid overwriting the docker PID with a process PID
        const oldInstance = instanceManager.getInstance(req.kapeta!.systemId, req.kapeta!.instanceId);
        if (oldInstance) {
            instance.pid = oldInstance.pid;
            instance.desiredStatus = oldInstance.desiredStatus;
        }
        instance.type = InstanceType.DOCKER;
        instance.owner = InstanceOwner.INTERNAL;
    } else {
        // Coming from user starting the instance outside of kapeta
        instance.type = InstanceType.LOCAL;
        instance.owner = InstanceOwner.EXTERNAL;
        instance.desiredStatus = DesiredInstanceStatus.EXTERNAL;
    }

    try {
        await instanceManager.registerInstanceFromSDK(req.kapeta!.systemId, req.kapeta!.instanceId, instance);
        res.status(202).send({ ok: true });
    } catch (e: any) {
        res.status(400).send({ error: e.message });
    }
});

/**
 * Delete instance
 */
router.delete('/', async (req: KapetaRequest, res: Response) => {
    await instanceManager.markAsStopped(req.kapeta!.systemId, req.kapeta!.instanceId);

    res.status(202).send({ ok: true });
});

export default router;
