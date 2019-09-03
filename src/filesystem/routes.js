const {Router} = require('express');
var fileManager = require('../filesystemManager')
/* GET home page. */


let router = new Router();

router.get('/list/:path',  (req, res) => {   
  let pathArg =  req.params.path;
  res.send( fileManager.readDirectory(pathArg))
});

router.get('/readfile/:path', (req, res) => {
  let pathArg =  req.params.path;
  
  res.send(fileManager.readFile(pathArg));
});

router.put('/mkdir/:path',  (req, res )=> {
  let pathArg =  req.params.path;
  res.send(fileManager.createFolder(pathArg))
});

router.post('/writefile/:path',  (req, res)=> {
  let pathArg =  req.params.path;
  res.send(fileManager.writeFile(pathArg,req.stringBody))
});


router.get('/root', (req,res)=>{
  console.log(req.params);
  
  res.send(fileManager.getRootFolder())
});

module.exports = router;
