const {Router} = require('express');
const router = new Router();
const networkManager = require('../networkManager');

router.get('/:systemId/:serviceId/', (req, res) => {
    res.send(networkManager.getTrafficForService(req.params.systemId, req.params.serviceId));
});


module.exports = router;