/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Path from 'path';
import FS from 'fs';
import FSExtra from 'fs-extra';
import { storageService } from './storageService';

const SECTION_ID = 'filesystem';
const PROJECT_ROOT = 'project_root';

function isFile(path: string) {
    try {
        return FS.statSync(path).isFile();
    } catch (error) {
        return false;
    }
}

class FilesystemManager {
    async writeFile(path: string, data: string | Buffer) {
        const dirName = Path.dirname(path);
        if (!FS.existsSync(dirName)) {
            FSExtra.mkdirpSync(dirName, {});
        }
        FS.writeFileSync(path, data);
    }

    async createFolder(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            FS.mkdir(path, (err) => {
                if (err) {
                    err.message += '. You can only create one single folder at a time.';
                    reject(err.message);
                    return;
                }
                resolve();
            });
        });
    }

    async readDirectory(path: string): Promise<{ path: string; folder: boolean }[]> {
        return new Promise((resolve, reject) => {
            let response: { path: string; folder: boolean }[] = [];
            FS.readdir(path, (err: any, files: string[]) => {
                if (err) {
                    reject(new Error(err));
                    return;
                }
                files.forEach((file) => {
                    response.push({
                        path: Path.join(path, file),
                        folder: FS.lstatSync(Path.join(path, file)).isDirectory(),
                    });
                });
                resolve(response);
            });
        });
    }

    async readFile(path: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            if (!isFile(path)) {
                reject(
                    new Error(
                        'The path provided is invalid.Please check that the path and file name that were provided are spelled correctly. '
                    )
                );
            } else {
                FS.readFile(path, (err, data) => {
                    if (err) {
                        reject(new Error(err.message));
                        return;
                    }
                    resolve(data);
                });
            }
        });
    }

    getRootFolder(): string {
        return require('os').homedir();
    }

    getProjectRootFolder(): string | undefined {
        return storageService.get(SECTION_ID, PROJECT_ROOT);
    }

    setProjectRootFolder(folder: string) {
        storageService.put(SECTION_ID, PROJECT_ROOT, folder);
    }
}

export const filesystemManager = new FilesystemManager();
