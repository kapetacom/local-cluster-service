

var fs = require("fs");

module.exports = {

  isFile:function isFile(path){
    try {
      return fs.statSync(path).isFile()
    } catch (error) {
      return false;
    }
  },
  writeFile:function writeFile(path,data){
    fs.writeFile(path, data ,(err)=>{
      if(err){
        err.message+=". You can only create files in existing directories.";
        return err
      }
      return 200
    })
  },
  createFolder:function createFolder(path){
    let res = new Response()
    fs.mkdir(path,(err)=>{
      if(err){
        res.statusCode = 500;
        err.message+=". You can only create one single folder at a time.";
        return err;
      }
      res.statusCode =200;
      return 200;
    })
  },
  readDirectory:function readDirectory(path){
    fs.readdir(pathArg,(err,files)=>{
      let response = [];
      files.forEach((file)=>{
        response.push({path:path.join(pathArg,file),folder:fs.lstatSync(path.join(pathArg,file)).isDirectory()})
      });
      return response;
    });
  },
  readFile:function readFile(path){
    if(!isFile(pathArg)){
      return new Error("The path provided is invalid.Please check that the path and file name that were provided are spelled correctly. ");
    }else{
      return fs.readFileSync(pathArg);
    }
  }
}