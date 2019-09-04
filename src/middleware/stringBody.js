module.exports = function stringBody (req, res, next) {

    // push the data to body
    const body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', () => {
        req.stringBody = Buffer.concat(body).toString();
        next();
    });
};