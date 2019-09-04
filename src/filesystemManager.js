
var Path = require("path");
var fs = require("fs");

function isFile(path){
  try {
    return fs.statSync(path).isFile()
  } catch (error) {
    return false;
  }
}
module.exports = {
  writeFile: async function writeFile(path,data){
    return new Promise((resolve,reject)=>{
      fs.writeFile(path, data ,(err)=>{
        if(err){
          err.message+=". You can only create files in existing directories.";
          reject( err.message)
        }
        resolve(200);
      })
    })
  },
  createFolder: async function createFolder(path){
    return new Promise((resolve,reject)=>{
      fs.mkdir(path,(err)=>{
        if(err){
          err.message+=". You can only create one single folder at a time.";
          reject(err.message);
          return ;
        }
        resolve(200);
      })
    })
  },
  readDirectory: async function readDirectory(path){
    return new Promise((resolve,reject)=>{
      let response = [];
      fs.readdir(path,(err,files)=>{
        if(err)  {
          reject(new Error(err));
          return;
        }
        files.forEach((file)=>{
          response.push({path:Path.join(path,file),folder:fs.lstatSync(Path.join(path,file)).isDirectory()})
        });
        resolve(response)
      });
    })
  },
  readFile: async function readFile(path){
    return new Promise((resolve,reject)=>{
      if(!isFile(path)){
        reject( new Error("The path provided is invalid.Please check that the path and file name that were provided are spelled correctly. "));
      }else{
        fs.readFile(path,(err,data)=>{
          if(err){
            reject(new Error(err.message));
            return;
          }
          resolve(data)
        });
      }
    })
  },
  getRootFolder:function getRootFolder(){
    return require('os').homedir();
  }
}