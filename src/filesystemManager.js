const Path = require("path");
const FS = require("fs");
const FSExtra = require('fs-extra');
const storageService = require('./storageService');
const SECTION_ID = 'filesystem';
const PROJECT_ROOT = 'project_root';

function isFile(path) {
    try {
        return FS.statSync(path).isFile()
    } catch (error) {
        return false;
    }
}

class FilesystemManager {

    async writeFile(path, data) {
        const dirName = Path.dirname(path);
        console.log('Dir name', dirName, path);
        if (!FS.existsSync(dirName)) {
            console.log('Making folder', dirName);
            FSExtra.mkdirpSync(dirName, {});
        }
        FS.writeFileSync(path, data);
    }

    async createFolder(path) {
        return new Promise((resolve, reject) => {
            FS.mkdir(path, (err) => {
                if (err) {
                    err.message += ". You can only create one single folder at a time.";
                    reject(err.message);
                    return;
                }
                resolve();
            })
        })
    }

    async readDirectory(path) {
        return new Promise((resolve, reject) => {
            let response = [];
            FS.readdir(path, (err, files) => {
                if (err) {
                    reject(new Error(err));
                    return;
                }
                files.forEach((file) => {
                    response.push({
                        path: Path.join(path, file),
                        folder: FS.lstatSync(Path.join(path, file)).isDirectory()
                    })
                });
                resolve(response)
            });
        })
    }

    async readFile(path) {
        return new Promise((resolve, reject) => {
            if (!isFile(path)) {
                reject(new Error("The path provided is invalid.Please check that the path and file name that were provided are spelled correctly. "));
            } else {
                FS.readFile(path, (err, data) => {
                    if (err) {
                        reject(new Error(err.message));
                        return;
                    }
                    resolve(data)
                });
            }
        })
    }

    getRootFolder() {
        return require('os').homedir();
    }

    getProjectRootFolder() {
        return storageService.get(SECTION_ID, PROJECT_ROOT);
    }

    setProjectRootFolder(folder) {
        storageService.put(SECTION_ID, PROJECT_ROOT, folder);
    }
}

module.exports = new FilesystemManager();