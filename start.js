const localClusterService = require('./index.js');

localClusterService.start()
    .then(({host,port}) => console.log('Listening on port %s:%s', host, port))
    .catch(e => {
        console.error('Failed to start local cluster due to an error:\n\t - %s', e.toString())
    });