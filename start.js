const localClusterService = require('./index.js');

localClusterService.start().then(({host,port}) => console.log('Listening on port %s:%s', host, port));