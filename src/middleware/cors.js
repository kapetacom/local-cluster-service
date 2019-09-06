module.exports = function cors(req, res, next) {
    res.set('Access-Control-Allow-Origin', req.headers.origin);
    res.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, PATCH');
    res.set('Access-Control-Allow-Headers', '*');

    next();
};