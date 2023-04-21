
module.exports = function kapeta(req, res, next) {

    let blockRef = req.headers['x-kapeta-block'];
    let systemId = req.headers['x-kapeta-system'];
    let instanceId = req.headers['x-kapeta-instance'];

    req.kapeta = {
        blockRef,
        instanceId,
        systemId
    };

    next();
};
