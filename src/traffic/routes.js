const {Router} = require('express');
const router = new Router();
const networkManager = require('../networkManager');

router.get('/:service/', (req, res) => {
    res.send(networkManager.getTrafficForService(req.params.service));
});


module.exports = router;