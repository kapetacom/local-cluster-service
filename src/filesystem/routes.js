const {Router} = require('express');
var fileManager = require('../filesystemManager')
/* GET home page. */

let router = new Router();

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

router.get('/list', async (req, res) => {   
  let pathArg =  req.query.path;
  res.send( await fileManager.readDirectory(pathArg))
});

router.get('/readfile', async (req, res) => {
  let pathArg =  req.query.path;
  res.send(await fileManager.readFile(pathArg));
});

router.put('/mkdir', async (req, res )=> {
  let pathArg =  req.query.path;  
  res.sendStatus(await fileManager.createFolder(pathArg))
});

router.post('/writefile', async (req, res)=> {
  let pathArg =  req.query.path;
  fileManager.writeFile(pathArg,req.stringBody).then(code=>{
    res.sendStatus(code)
  }).catch(err=>{
    res.send(err);
  })
});


router.get('/root', (req,res)=>{
  res.send(fileManager.getRootFolder());
});

module.exports = router;
