const { Router } = require('express');
var fileManager = require('../filesystemManager')
/* GET home page. */

let router = new Router();


router.get('/root', (req, res) => {
  res.send(fileManager.getRootFolder());
});
router.use('/writefile', (req, res, next) => {
  // push the data to body
  var body = [];
  req.on('data', (chunk) => {
    body.push(chunk);
  }).on('end', () => {
    req.stringBody = Buffer.concat(body).toString();
    next();
  });
});


//
router.use("/",(req,res,next)=>{
  if (!req.query.path) {
    res.status(400).send({ error: 'Missing required query parameter "path"' });
    return;
  }
  next();
})


router.get('/list', async (req, res) => {
  let pathArg = req.query.path;
 
  try {
    res.send(await fileManager.readDirectory(pathArg))
  } catch (error) {
    res.status(400).send(err);
  }

});

router.get('/readfile', async (req, res) => {
  let pathArg = req.query.path;
  try {
    res.send(await fileManager.readFile(pathArg));
  } catch (error) {
    res.status(400).send(err);
  }
});

router.put('/mkdir', async (req, res) => {
  let pathArg = req.query.path;
  try {
    await fileManager.createFolder(pathArg)
    res.sendStatus(204);
  } catch (error) {
    res.status(400).send(err);
  }
});

router.post('/writefile', async (req, res) => {
  let pathArg = req.query.path;
  try {
    await fileManager.writeFile(pathArg, req.stringBody)
    res.sendStatus(204);
  } catch (error) {
    res.status(400).send(err);
  }
});

module.exports = router;
