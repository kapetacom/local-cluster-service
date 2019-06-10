const localClusterService = require('./index');

localClusterService.start().then(port => console.log('Listening on port localhost:%s', port));