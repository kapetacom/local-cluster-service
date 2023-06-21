const Router = require('express-promise-router').default;

const instanceManager = require('../instanceManager');
const serviceManager = require('../serviceManager');


const router = new Router();
router.use('/', require('../middleware/cors'));

/**
 * Get all instances
 */
router.get('/', (req, res) => {
    res.send(instanceManager.getInstances());
});

/**
 * Get all instances
 */
router.get('/:systemId/instances', (req, res) => {
    res.send(instanceManager.getInstancesForPlan(req.params.systemId));
});

/**
 * Start all instances in a plan
 */
router.post('/:systemId/start', async (req, res) => {
    const processes = await instanceManager.createProcessesForPlan(req.params.systemId);

    res.status(202).send({
        ok: true,
        processes: processes.map(p => {
            return {pid: p.pid, type: p.type};
        })
    });
});

/**
 * Stop all instances in plan
 */
router.post('/:systemId/stop', async (req, res) => {
    await instanceManager.stopAllForPlan(req.params.systemId);

    res.status(202).send({
        ok: true
    });
});

/**
 * Start single instance in a plan
 */
router.post('/:systemId/:instanceId/start', async (req, res) => {
    const process = await instanceManager.createProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({
        ok: true,
        pid: process.pid,
        type: process.type
    });
});

/**
 * Stop single instance in a plan
 */
router.post('/:systemId/:instanceId/stop', async (req, res) => {
    await instanceManager.stopProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({ok: true});
});


/**
 * Get logs for instance in a plan
 */
router.get('/:systemId/:instanceId/logs', (req, res) => {
    const processInfo = instanceManager.getProcessForInstance(req.params.systemId, req.params.instanceId);
    if (!processInfo) {
        res.status(404).send({ok: false});
        return;
    }

    res.status(202).send({
        logs: processInfo.logs()
    });
});


/**
 * Get public address for instance in a plan if available
 */
router.get('/:systemId/:instanceId/address/public', (req, res) => {
    const instance = instanceManager.getInstance(req.params.systemId, req.params.instanceId);
    if (!instance) {
        res.status(404).send({ok: false});
        return;
    }

    if (!instance.address) {
        res.status(400).send({error: `Instance does not have an address. Make sure it's running.`});
        return;
    }

    res.status(200).send(instance.address);
});

/**
 * Get public address for particular resource on instance in a plan if available
 */
router.get('/:systemId/:instanceId/provider/:portType/:resourceName/address/public', (req, res) => {
    res.send(serviceManager.getConsumerAddress(
        req.params.systemId,
        req.params.instanceId,
        req.params.resourceName,
        req.params.portType,
        req.headers['x-kapeta-environment'],
    ));
});

router.use('/', require('../middleware/stringBody'));
router.use('/', require('../middleware/kapeta'));
router.use('/', (req, res, next) => {
    if (!req.kapeta.blockRef) {
        res.status(400).send({error: 'Missing X-Kapeta-Block header.'});
        return;
    }
    next();
})

/**
 * Updates the full configuration for a given service.
 */
router.put('/', async (req, res) => {

    let instance = JSON.parse(req.stringBody);
    if (req.kapeta.environment === 'docker') {
        //A bit hacky but we want to avoid overwriting the docker PID with a process PID
        const oldInstance = instanceManager.getInstance(
            req.kapeta.systemId,
            req.kapeta.instanceId
        );
        if (oldInstance) {
            instance.pid = oldInstance.pid;
        }
        instance.type = 'docker';
    } else if (req.kapeta.environment === 'process') {
        instance.type = 'process';
    }

    await instanceManager.registerInstance(
        req.kapeta.systemId,
        req.kapeta.instanceId,
        instance
    );

    res.status(202).send({ok: true});
});

/**
 * Delete instance
 */
router.delete('/', async (req, res) => {
    await instanceManager.setInstanceAsStopped(req.kapeta.systemId, req.kapeta.instanceId);

    res.status(202).send({ok: true});
});


module.exports = router;
