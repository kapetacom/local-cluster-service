
module.exports = function blockware(req, res, next) {

    let blockRef = req.headers['x-blockware-block'];
    let systemId = req.headers['x-blockware-system'];
    let instanceId = req.headers['x-blockware-instance'];

    if (!blockRef) {
        res.status(400).send({error: 'Missing X-Blockware-Block header.'});
        return;
    }

    req.blockware = {
        blockRef,
        instanceId,
        systemId
    };

    next();
};