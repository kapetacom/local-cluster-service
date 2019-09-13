module.exports = function blockware(req, res, next) {
    req.blockware = {
        serviceId: req.headers['x-blockware-service'],
        systemId: req.headers['x-blockware-system']
    };

    next();
};