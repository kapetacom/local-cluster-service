const Router = require('express-promise-router').default;
const providerManager = require('../providerManager');

const router = new Router();

router.use('/', require('../middleware/cors'));

router.get('/', async (req, res) => {
    const result = await providerManager.getWebProviders();

    res.send(result);
});

router.get('/asset/:handle/:name/:version/web.js', async (req, res) => {

    const {handle, name, version} = req.params;
    let result = await providerManager.getAsset(handle, name, version);

    if (version !== 'local') {
        res.setHeader('Cache-Control', 'max-age=31536000, immutable');
    }


    if (!result) {
        res.status(404).send('');
    } else {
        res.send(result
            .replace(`${name}.js.map`, 'web.js.map')
        );
    }
});

router.get('/asset/:handle/:name/:version/web.js.map', async (req, res) => {

    const {handle, name, version} = req.params;
    const result = await providerManager.getAsset(handle, name, version, true);
    if (version !== 'local') {
        res.setHeader('Cache-Control', 'max-age=31536000, immutable');
    }

    if (!result) {
        res.status(404).send('');
    } else {
        res.send(result);
    }
});


module.exports = router;