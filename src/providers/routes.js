const Router = require('express-promise-router').default;
const providerManager = require('../providerManager');

const router = new Router();

router.use('/', require('../middleware/cors'));

/**
 * Get all local assets available
 */
router.get('/all.js', (req, res) => {
    res.send(providerManager.getPublicJS());
});

router.get('/asset/*', (req, res) => {
    const assetId = req.params[0];
    const result = providerManager.getAsset(assetId)
    if (!result) {
        res.status(404).send('');
    } else {
        res.send(result);
    }
});


module.exports = router;