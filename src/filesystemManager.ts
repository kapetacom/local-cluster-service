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
const EDITOR = 'editor';
const RELEASE_CHANNEL = 'release_channel';
const SHOW_PIXEL_GRID = 'show_pixel_grid';
const SNAP_TO_PIXEL_GRID = 'snap_to_pixel_grid';

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

    getEditor(): string | undefined {
        return storageService.get(SECTION_ID, EDITOR);
    }

    setEditor(editor: string) {
        storageService.put(SECTION_ID, EDITOR, editor);
    }

    // Should we put this in its own manager service?
    getReleaseChannel() {
        return storageService.get<string>('app', RELEASE_CHANNEL);
    }

    setReleaseChannel(channel: string) {
        storageService.put('app', RELEASE_CHANNEL, channel);
    }

    getShowPixelGrid() {
        return storageService.get<boolean>('app', SHOW_PIXEL_GRID, false);
    }

    setShowPixelGrid(show: boolean) {
        storageService.put('app', SHOW_PIXEL_GRID, show);
    }

    getSnapToPixelGrid() {
        return storageService.get<boolean>('app', SNAP_TO_PIXEL_GRID, false);
    }

    setSnapToPixelGrid(snap: boolean) {
        storageService.put('app', SNAP_TO_PIXEL_GRID, snap);
    }
}

export const filesystemManager = new FilesystemManager();
