const {Router} = require('express');
const providerManager = require('../providerManager');

const router = new Router();

router.use('/', require('../middleware/cors'));

/**
 * Get all local assets available
 */
router.get('/all.js', (req, res) => {
    res.send(providerManager.getPublicJS());
});


module.exports = router;