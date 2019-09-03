const {Router} = require('express');
const YAML = require('yaml');
const assetManager = require('../assetManager');

const router = new Router();

router.use('/', (req, res, next) => {
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
 * Get all local assets available
 */
router.get('/', (req, res) => {
    res.send(assetManager.getAssets());
});

/**
 * Unregisters an asset (doesn't delete the asset)
 */
router.delete('/', (req, res) => {
    if (!req.query.path) {
        res.status(400).send({error:'Query parameter "path" is missing'});
        return;
    }

    try {
        assetManager.unregisterAsset(req.query.path);

        res.status(204).send();
    } catch(err) {
        res.status(400).send({error: err.message});
    }
});

/**
 * Creates a new local file and registers it as an asset
 */
router.post('/create', (req, res) => {
    if (!req.query.path) {
        res.status(400).send({error:'Query parameter "path" is missing'});
        return;
    }

    try {
        const asset = assetManager.createAsset(req.query.path, YAML.parse(req.stringBody));

        res.status(200).send(asset);
    } catch(err) {
        res.status(400).send({error: err.message});
    }

});

/**
 * Registers an existing file as an asset
 */
router.put('/import', (req, res) => {
    if (!req.query.path) {
        res.status(400).send({error:'Path parameter is missing'});
        return;
    }

    try {
        const asset = assetManager.registerAsset(req.query.path);

        res.status(200).send(asset);
    } catch(err) {
        res.status(400).send({error: err.message});
    }
});

module.exports = router;