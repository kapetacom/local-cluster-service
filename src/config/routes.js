const Router = require('express-promise-router').default;
const configManager = require('../configManager');
const serviceManager = require('../serviceManager');
const operatorManager = require('../operatorManager');
const instanceManager = require('../instanceManager');

const router = new Router();
const SYSTEM_ID = '$plan';

router.use('/', require('../middleware/cors'));
router.use('/', require('../middleware/kapeta'));
router.use('/', require('../middleware/stringBody'));

/**
 * Returns the full configuration for a given service.
 */
router.get('/instance', (req, res) => {

    const config = req.kapeta.instanceId ?
        configManager.getConfigForSection(req.kapeta.systemId, req.kapeta.instanceId) :
        configManager.getConfigForSystem(req.kapeta.systemId);

    res.send(config);
});

/**
 * Updates the full configuration for a given service.
 */
router.put('/instance', async (req, res) => {

    try {
        let config = JSON.parse(req.stringBody);
        if (!config) {
            config = {};
        }

        if (req.kapeta.instanceId) {
            configManager.setConfigForSection(
                req.kapeta.systemId,
                req.kapeta.instanceId,
                config
            );
            //Restart the instance if it is running after config change
            await instanceManager.restartIfRunning(req.kapeta.systemId, req.kapeta.instanceId);
        } else {
            configManager.setConfigForSystem(
                req.kapeta.systemId,
                config
            );
        }

    } catch(err) {
        console.error('Failed to update instance config', err);
        res.status(400).send({error: err.message});
        return;
    }

    res.status(202).send({ok:true});
});

/**
 * Returns the full configuration for a plan
 */
router.get('/system', (req, res) => {
    const config = configManager.getConfigForSection(req.kapeta.systemId, SYSTEM_ID);

    res.send(config);
});

/**
 * Updates the full configuration for a plan
 */
router.put('/system', (req, res) => {

    let config = JSON.parse(req.stringBody);
    if (!config) {
        config = {};
    }
    configManager.setConfigForSection(
        req.kapeta.systemId,
        SYSTEM_ID,
        config
    );
    res.status(202).send({ok:true});
});


/**
 * Resolves and checks the identity of a block instance
 */
router.get('/identity', async (req, res) => {


    const identity = {
        systemId: req.kapeta.systemId,
        instanceId: req.kapeta.instanceId
    };

    if (!req.kapeta.blockRef) {
        res.status(400).send({error: 'Missing required header "X-Kapeta-Block"'});
        return;
    }

    try {

        if (!identity.systemId ||
            !identity.instanceId) {
            const {systemId, instanceId} = await configManager.resolveIdentity(req.kapeta.blockRef, identity.systemId);
            identity.systemId = systemId;
            identity.instanceId = instanceId;
        } else {
            await configManager.verifyIdentity(req.kapeta.blockRef, identity.systemId, identity.instanceId);
        }

        res.send(identity);
    } catch(err) {
        console.warn('Failed to resolve identity', err);
        res.status(400).send({error: err.message});
    }
});

/**
 * Services call this to request a free port. If a service has
 * already called the endpoint the same port is returned.
 */
router.get('/provides/:type', async (req, res) => {
    //Get service port
    res.send('' + await serviceManager.ensureServicePort(
        req.kapeta.systemId,
        req.kapeta.instanceId,
        req.params.type
    ));
});

/**
 * Used by services to get info for consumed operator resource.
 *
 * If the operator resource is not already available this will cause it to start an instance and
 * assign port numbers to it etc.
 */
router.get('/consumes/resource/:resourceType/:portType/:name', async (req, res) => {
    const operatorInfo = await operatorManager.getConsumerResourceInfo(
        req.kapeta.systemId,
        req.kapeta.instanceId,
        req.params.resourceType,
        req.params.portType,
        req.params.name,
        req.kapeta.environment
    );

    res.send(operatorInfo);
});

/**
 * Used by services to get address for their clients.
 *
 * If the remote service is not already registered with a port - we do that here
 * to handle clients for services that hasn't started yet.
 */
router.get('/consumes/:resourceName/:type', (req, res) => {
    res.send(serviceManager.getConsumerAddress(
        req.kapeta.systemId,
        req.kapeta.instanceId,
        req.params.resourceName,
        req.params.type,
        req.kapeta.environment,
    ));
});

module.exports = router;
