const {Router} = require('express');
const YAML = require('yaml');
const configManager = require('../configManager');
const serviceManager = require('../serviceManager');
const operatorManager = require('../operatorManager');

const router = new Router();

router.use('/:service', (req, res, next) => {
    // push the data to body
    var body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        req.stringBody = Buffer.concat(body).toString();
        next();
    });
});

/**
 * Returns the full configuration for a given service.
 */
router.get('/:service', (req, res) => {
    //Get service YAML config
    const config = configManager.getConfigForService(req.params.service);

    res.send(YAML.stringify(config));
});


/**
 * Updates the full configuration for a given service.
 */
router.put('/:service', (req, res) => {

    let config = YAML.parse(req.stringBody);
    if (!config) {
        config = {};
    }
    //Get service YAML config
    configManager.setConfigForService(req.params.service, config);
    res.status(202).send({ok:true});
});

/**
 * Services call this to request a free port. If a service has
 * already called the endpoint the same port is returned.
 */
router.get('/:service/provides/:type', async (req, res) => {
    //Get service port
    res.send('' + await serviceManager.ensureServicePort(req.params.service, req.params.type));
});

/**
 * Used by services to get info for consumed operator resource.
 *
 * If the operator resource is not already available this will cause it to start an instance and
 * assign port numbers to it etc.
 */
router.get('/:fromService/consumes/resource/:resourceType/:portType', async (req, res) => {

    const operatorInfo = await operatorManager.getResourceInfo(
        req.params.fromService,
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
router.get('/:fromService/consumes/:toService/:type', (req, res) => {

    res.send(serviceManager.getConsumerAddress(req.params.fromService, req.params.toService, req.params.type));
});

module.exports = router;