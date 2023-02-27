const Router = require('express-promise-router').default;
const YAML = require('yaml');
const configManager = require('../configManager');
const serviceManager = require('../serviceManager');
const operatorManager = require('../operatorManager');

const router = new Router();

router.use('/', require('../middleware/blockware'));
router.use('/', require('../middleware/stringBody'));

/**
 * Returns the full configuration for a given service.
 */
router.get('/', (req, res) => {
    //Get service YAML config
    const config = configManager.getConfigForService(req.blockware.systemId, req.blockware.instanceId);

    res.send(YAML.stringify(config));
});

/**
 * Updates the full configuration for a given service.
 */
router.put('/', (req, res) => {

    let config = YAML.parse(req.stringBody);
    if (!config) {
        config = {};
    }
    //Get service YAML config
    configManager.setConfigForService(
        req.blockware.systemId,
        req.blockware.instanceId,
        config
    );
    res.status(202).send({ok:true});
});


/**
 * Resolves and checks the identify of a block instance
 */
router.get('/identity', async (req, res) => {


    const identity = {
        systemId: req.blockware.systemId,
        instanceId: req.blockware.instanceId
    };

    try {

        if (!identity.systemId ||
            !identity.instanceId) {
            const {systemId, instanceId} = await configManager.resolveIdentity(req.blockware.blockRef, identity.systemId);
            identity.systemId = systemId;
            identity.instanceId = instanceId;
        } else {
            await configManager.verifyIdentity(req.blockware.blockRef, identity.systemId, identity.instanceId);
        }

        res.send(identity);
    } catch(err) {
        console.log(err);
        
        res.send({error: err.message});
    }
});

/**
 * Services call this to request a free port. If a service has
 * already called the endpoint the same port is returned.
 */
router.get('/provides/:type', async (req, res) => {
    //Get service port
    res.send('' + await serviceManager.ensureServicePort(
        req.blockware.systemId,
        req.blockware.instanceId,
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
    const operatorInfo = await operatorManager.getResourceInfo(
        req.blockware.systemId,
        req.blockware.instanceId,
        req.params.resourceType,
        req.params.portType,
        req.params.name
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
        req.blockware.systemId,
        req.blockware.instanceId,
        req.params.resourceName,
        req.params.type
    ));
});

module.exports = router;