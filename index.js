const clusterService = require('./src/clusterService');
const express = require('express');
const app = express();

app.use('/traffic', require('./src/traffic/routes'));
app.use('/proxy', require('./src/proxy/routes'));
app.use('/config', require('./src/config/routes'));

const port = clusterService.getClusterServicePort();

app.listen(port, () => console.log(`Local cluster service listening on port ${port}`));