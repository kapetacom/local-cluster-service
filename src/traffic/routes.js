const {Router} = require('express');
const router = new Router();
const networkManger = require('../networkManager');

router.get('/:service/', (req, res) => {
    res.send(networkManger.getTrafficForService(req.params.service));
});


module.exports = router;