const {Router} = require('express');
const {BlockwareAPI} = require('@blockware/nodejs-api-client');

const instanceManager = require('../instanceManager');

const router = new Router();
const api = new BlockwareAPI();

router.use('/', require('../middleware/cors'));

router.get('/current', async (req, res) => {
    res.send(await api.getCurrentIdentity());
});

router.get('/:identityId/memberships', async (req, res) => {
    res.send(await api.getMemberships(req.params.identityId));
});

module.exports = router;