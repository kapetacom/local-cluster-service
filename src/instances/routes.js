const {Router} = require('express');
const instanceManager = require('../instanceManager');

const router = new Router();

/**
 * Get all instances
 */
router.get('/', (req, res) => {
    res.send(instanceManager.getInstances());
});

router.use('/', require('../middleware/cors'));
router.use('/', require('../middleware/blockware'));
router.use('/', require('../middleware/stringBody'));

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