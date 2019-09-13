const {Router} = require('express');
const YAML = require('yaml');
const configManager = require('../configManager');
const serviceManager = require('../serviceManager');
const operatorManager = require('../operatorManager');

const router = new Router();

router.use('/', require('../middleware/blockware'));

router.use('/:serviceId', require('../middleware/stringBody'));

/**
 * Returns the full configuration for a given service.
 */
router.get('/:serviceId', (req, res) => {
    //Get service YAML config
    const config = configManager.getConfigForService(req.blockware.systemId, req.params.serviceId);

    res.send(YAML.stringify(config));
});


/**
 * Updates the full configuration for a given service.
 */
router.put('/:serviceId', (req, res) => {

    let config = YAML.parse(req.stringBody);
    if (!config) {
        config = {};
    }
    //Get service YAML config
    configManager.setConfigForService(
        req.blockware.systemId,
        req.params.serviceId,
        config
    );
    res.status(202).send({ok:true});
});

/**
 * Services call this to request a free port. If a service has
 * already called the endpoint the same port is returned.
 */
router.get('/:serviceId/provides/:type', async (req, res) => {
    //Get service port
    res.send('' + await serviceManager.ensureServicePort(
        req.blockware.systemId,
        req.params.serviceId,
        req.params.type
    ));
});

/**
 * Used by services to get info for consumed operator resource.
 *
 * If the operator resource is not already available this will cause it to start an instance and
 * assign port numbers to it etc.
 */
router.get('/:fromServiceId/consumes/resource/:resourceType/:portType', async (req, res) => {
    const operatorInfo = await operatorManager.getResourceInfo(
        req.blockware.systemId,
        req.params.fromServiceId,
        req.params.resourceType,
        req.params.portType
    );

    res.send(operatorInfo);
});

/**
 * Used by services to get address for their clients.
 *
 * If the remote service is not already registered with a port - we do that here
 * to handle clients for services that hasn't started yet.
 */
router.get('/:fromServiceId/consumes/:toServiceId/:type', (req, res) => {

    res.send(serviceManager.getConsumerAddress(
        req.blockware.systemId,
        req.params.fromServiceId,
        req.params.toServiceId,
        req.params.type
    ));
});

module.exports = router;