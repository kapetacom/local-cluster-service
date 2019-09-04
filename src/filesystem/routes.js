const { Router } = require('express');
const fileManager = require('../filesystemManager');

let router = new Router();

router.use('/', require('../middleware/cors'));

router.get('/root', (req, res) => {
  res.send(fileManager.getRootFolder());
});


router.use('/writefile', require('../middleware/stringBody'));

router.use("/",(req,res,next)=>{
  if (!req.query.path) {
    res.status(400).send({ error: 'Missing required query parameter "path"' });
    return;
  }
  next();
});


router.get('/list', async (req, res) => {
  let pathArg = req.query.path;
 
  try {
    res.send(await fileManager.readDirectory(pathArg))
  } catch (err) {
    res.status(400).send({error:''+err});
  }

});

router.get('/readfile', async (req, res) => {
  let pathArg = req.query.path;
  try {
    res.send(await fileManager.readFile(pathArg));
  } catch (err) {
    res.status(400).send({error:''+err});
  }
});

router.put('/mkdir', async (req, res) => {
  let pathArg = req.query.path;
  try {
    await fileManager.createFolder(pathArg);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).send({error:''+err});
  }
});

router.post('/writefile', async (req, res) => {
  let pathArg = req.query.path;
  try {
    await fileManager.writeFile(pathArg, req.stringBody);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).send({error:''+err});
  }
});

module.exports = router;
