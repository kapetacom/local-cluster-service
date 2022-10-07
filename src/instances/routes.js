const {Router} = require('express');

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
 * Start all instances in a plan
 */
router.post('/:systemId/start', (req, res) => {
    instanceManager.startAllInstances(req.params.systemId);

    res.status(202).send({ok:true});
});

/**
 * Stop all instances in plan
 */
router.post('/:systemId/stop', (req, res) => {
    instanceManager.stopAllInstances(req.params.systemId);

    res.status(202).send({ok:true});
});

/**
 * Start single instance in a plan
 */
router.post('/:systemId/:instanceId/start', (req, res) => {
    instanceManager.startInstance(req.params.systemId, req.params.instanceId);

    res.status(202).send({ok:true});
});

/**
 * Stop single instance in a plan
 */
router.post('/:systemId/:instanceId/stop', (req, res) => {
    instanceManager.stopInstance(req.params.systemId, req.params.instanceId);

    res.status(202).send({ok:true});
});


/**
 * Get logs for instance in a plan
 */
router.get('/:systemId/:instanceId/logs', (req, res) => {
    const process = instanceManager.getProcessForInstance(req.params.systemId, req.params.instanceId);
    if (!process) {
        res.status(404).send({ok:false});
        return;
    }

    res.status(202).send({logs:process.logs});
});

router.use('/', require('../middleware/stringBody'));


router.use('/', require('../middleware/blockware'));

/**
 * Updates the full configuration for a given service.
 */
router.put('/', (req, res) => {

    let instance = JSON.parse(req.stringBody);

    instanceManager.registerInstance(
        req.blockware.systemId,
        req.blockware.instanceId,
        instance
    );

    res.status(202).send({ok:true});
});

/**
 * Delete instance
 */
router.delete('/', (req, res) => {
    instanceManager.instanceStopped(req.blockware.systemId, req.blockware.instanceId);

    res.status(202).send({ok:true});
});


module.exports = router;