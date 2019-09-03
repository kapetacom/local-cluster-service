var express = require('express');
const {Router} = require('express');
var fileManager = require('../filesystemManager')
/* GET home page. */



let router = new Router();
router.use('/writefile/:path', (req, res, next) => {
  // push the data to body
  var body = [];
  req.on('data', (chunk) => {
      body.push(chunk);
  }).on('end', () => {
      req.stringBody = Buffer.concat(body).toString();
      next();
  });
});

router.get('/:path', function (req, res) {
  let pathArg =  req.params.path;
  res.send(fileManager.readDirectory(pathArg))
});

router.get('/readfile/:path', function (req, res) {
  let pathArg =  req.params.path;
  res.send(fileManager.readFile(pathArg));
});

router.put('/createfolder/:path', function (req, res, next) {
  let pathArg =  req.params.path;
  res.send(fileManager.createFolder(pathArg))
});

router.put('/writefile/:path', function (req, res, next) {
  let pathArg =  req.params.path;
  res.send(fileManager.writeFile(pathArg,req.stringBody))
});

module.exports = router;
