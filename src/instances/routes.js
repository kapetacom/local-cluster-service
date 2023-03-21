const Router = require('express-promise-router').default;

const instanceManager = require('../instanceManager');


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
        ok:true,
        processes: processes.map(p => {
            return {pid:p.pid, type:p.type};
        })
    });
});

/**
 * Stop all instances in plan
 */
router.post('/:systemId/stop', async (req, res) => {
    await instanceManager.stopAllForPlan(req.params.systemId);

    res.status(202).send({
        ok:true
    });
});

/**
 * Start single instance in a plan
 */
router.post('/:systemId/:instanceId/start', async (req, res) => {
    const process = await instanceManager.createProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({
        ok:true,
        pid: process.pid,
        type: process.type
    });
});

/**
 * Stop single instance in a plan
 */
router.post('/:systemId/:instanceId/stop', async (req, res) => {
    await instanceManager.stopProcess(req.params.systemId, req.params.instanceId);

    res.status(202).send({ok:true});
});


/**
 * Get logs for instance in a plan
 */
router.get('/:systemId/:instanceId/logs', (req, res) => {
    const processInfo = instanceManager.getProcessForInstance(req.params.systemId, req.params.instanceId);
    if (!processInfo) {
        res.status(404).send({ok:false});
        return;
    }

    res.status(202).send({
        logs: processInfo.logs()
    });
});

router.use('/', require('../middleware/stringBody'));


router.use('/', require('../middleware/kapeta'));

/**
 * Updates the full configuration for a given service.
 */
router.put('/', async (req, res) => {

    let instance = JSON.parse(req.stringBody);

    await instanceManager.registerInstance(
        req.kapeta.systemId,
        req.kapeta.instanceId,
        instance
    );

    res.status(202).send({ok:true});
});

/**
 * Delete instance
 */
router.delete('/', async (req, res) => {
    await instanceManager.setInstanceAsStopped(req.kapeta.systemId, req.kapeta.instanceId);

    res.status(202).send({ok:true});
});


module.exports = router;
