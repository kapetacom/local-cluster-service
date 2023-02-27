const Router = require('express-promise-router').default;
const router = new Router();
const networkManager = require('../networkManager');

router.get('/:systemId/target/:connectionId/', (req, res) => {
    res.send(networkManager.getTrafficForConnection(req.params.systemId, req.params.connectionId));
});

router.get('/:systemId/source/:blockInstanceId/', (req, res) => {
    res.send(networkManager.getTrafficForSource(req.params.systemId, req.params.blockInstanceId));
});

router.get('/:systemId/target/:blockInstanceId/', (req, res) => {
    res.send(networkManager.getTrafficForTarget(req.params.systemId, req.params.blockInstanceId));
});


module.exports = router;