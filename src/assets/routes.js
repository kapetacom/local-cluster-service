const {Router} = require('express');
const YAML = require('yaml');
const assetManager = require('../assetManager');


function parseBody(req) {
    switch(req.headers['content-type']) {
        case 'application/json':
        case 'application/x-json':
        case 'text/json':
            return JSON.parse(req.stringBody);

        case 'application/yaml':
        case 'application/x-yaml':
        case 'text/yaml':
        case 'text/x-yaml':
        default:
            return YAML.parse(req.stringBody);
    }
}

const router = new Router();

router.use('/', require('../middleware/cors'));
router.use('/', require('../middleware/stringBody'));

/**
 * Get all local assets available
 */
router.get('/', (req, res) => {
    res.send(assetManager.getAssets());
});

/**
 * Get single asset
 */
router.get('/read', (req, res) => {
    if (!req.query.ref) {
        res.status(400).send({error:'Query parameter "ref" is missing'});
        return;
    }

    try {
        res.send(assetManager.getAsset(req.query.ref));
    } catch(err) {
        res.status(400).send({error: err.message});
    }

});

/**
 * Creates a new local file and registers it as an asset
 */
router.post('/create', async (req, res) => {
    if (!req.query.path) {
        res.status(400).send({error:'Query parameter "path" is missing'});
        return;
    }

    const content = parseBody(req);

    try {
        const asset = await assetManager.createAsset(req.query.path, content);

        res.status(200).send(asset);
    } catch(err) {
        console.log('Failed while creating asset', req.query.path, err.message);
        res.status(400).send({error: err.message});
    }

});

/**
 * Updates reference with new content
 */
router.put('/update', async (req, res) => {
    if (!req.query.ref) {
        res.status(400).send({error:'Query parameter "ref" is missing'});
        return;
    }

    const content = parseBody(req);

    try {
        await assetManager.updateAsset(req.query.ref, content);

        res.sendStatus(204);
    } catch(err) {
        console.log('Failed while updating asset', req.query.ref, err.message);
        res.status(400).send({error: err.message});
    }

});


/**
 * Unregisters an asset (doesn't delete the asset)
 */
router.delete('/', (req, res) => {
    if (!req.query.ref) {
        res.status(400).send({error:'Query parameter "ref" is missing'});
        return;
    }

    try {
        assetManager.unregisterAsset(req.query.ref);

        res.status(204).send();
    } catch(err) {
        res.status(400).send({error: err.message});
    }
});


/**
 * Registers an existing file as an asset
 */
router.put('/import', async (req, res) => {
    if (!req.query.ref) {
        res.status(400).send({error:'Query parameter "ref" is missing'});
        return;
    }

    try {
        const asset = await assetManager.importAsset(req.query.ref);

        res.status(200).send(asset);
    } catch(err) {
        res.status(400).send({error: err.message});
    }
});

module.exports = router;