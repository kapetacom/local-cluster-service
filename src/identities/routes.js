const Router = require('express-promise-router').default;
const {KapetaAPI} = require('@kapeta/nodejs-api-client');

const instanceManager = require('../instanceManager');

const router = new Router();
const api = new KapetaAPI();

router.use('/', require('../middleware/cors'));

router.get('/current', async (req, res) => {
    res.send(await api.getCurrentIdentity());
});

router.get('/:identityId/memberships', async (req, res) => {
    res.send(await api.getMemberships(req.params.identityId));
});

module.exports = router;
