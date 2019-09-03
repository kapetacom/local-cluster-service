const {Router} = require('express');
const YAML = require('yaml');
const assetManager = require('../assetManager');

const router = new Router();

router.use('/', (req, res, next) => {

    res.set('Access-Control-Allow-Origin', req.headers.origin);

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
 * Creates a new local file and registers it as an asset
 */
router.post('/create', async (req, res) => {
    if (!req.query.path) {
        res.status(400).send({error:'Query parameter "path" is missing'});
        return;
    }

    let content;
    switch(req.headers['content-type']) {
        case 'application/json':
        case 'application/x-json':
        case 'text/json':
            content = JSON.parse(req.stringBody);
            break;

        case 'application/yaml':
        case 'application/x-yaml':
        case 'text/yaml':
        case 'text/x-yaml':
        default:
            content = YAML.parse(req.stringBody);
            break;
    }

    try {
        const asset = await assetManager.createAsset(req.query.path, content);

        res.status(200).send(asset);
    } catch(err) {
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