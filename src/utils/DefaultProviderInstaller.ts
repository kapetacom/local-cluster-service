import Path from 'node:path';
import OS from 'node:os';
import ClusterConfiguration from '@kapeta/local-cluster-config';
import FS from 'fs-extra';
import request from 'request';
import { extract } from 'tar-stream';
import gunzip from 'gunzip-maybe';
import { filesystemManager } from '../filesystemManager';
import { Actions } from '@kapeta/nodejs-registry-utils';
import { ProgressListener } from '../progressListener';
import { glob } from 'glob';

const DEFAULT_PROVIDERS_URL = 'https://storage.googleapis.com/kapeta-production-cdn/archives/default-providers.tar.gz';
const DEFAULT_PROJECT_HOME_DIR = 'KapetaProjects';

const ARCHIVE_LOCAL_PREFIX = 'local';

class DefaultProviderInstaller {
    private readonly progressListener = new ProgressListener();

    public async checkForDefault() {
        const definitions = ClusterConfiguration.getDefinitions();
        if (definitions.length < 1) {
            console.log('Installing default providers');
            try {
                await this.install();
            } catch (e) {
                console.warn('Failed to install defaults', e);
            }
        }
    }

    private async install() {
        await this.download();
        await this.linkLocal();
    }

    private async linkLocal() {
        const projectBase = await this.ensureDefaultProjectHome();
        const folders = this.scanProjectBase(projectBase);
        for (let folder of folders) {
            console.log('Linking %s', folder);
            await Actions.link(this.progressListener, folder);
        }
    }

    private scanProjectBase(projectBase: string) {
        const assetFiles = glob.sync('*/**/kapeta.yml', { cwd: projectBase });
        return assetFiles.map((assetFile) => {
            return Path.dirname(Path.join(projectBase, assetFile));
        });
    }

    private async ensureDefaultProjectHome(): Promise<string> {
        const defaultProjectHome = Path.join(OS.homedir(), DEFAULT_PROJECT_HOME_DIR);
        let projectBase = filesystemManager.getProjectRootFolder();

        if (!projectBase) {
            filesystemManager.setProjectRootFolder(defaultProjectHome);
            projectBase = defaultProjectHome;
            if (!(await FS.pathExists(projectBase))) {
                await FS.mkdirp(projectBase);
            }
        }
        return projectBase;
    }

    private async download() {
        const projectBase: string = await this.ensureDefaultProjectHome();
        const repoBase: string = ClusterConfiguration.getRepositoryBasedir();

        return new Promise<void>((resolve, reject) => {
            const extractor = extract();
            const dirCache = new Set<string>();
            extractor.on('entry', async function (header, stream, next) {
                if (header.type !== 'file') {
                    stream.on('end', function () {
                        next(); // ready for next entry
                    });
                    stream.resume(); // just auto drain the stream
                    return;
                }

                // Local (editable) assets should be stored in the project folder
                // - installed assets goes into the repository folder
                const baseDir: string = header.name.startsWith(ARCHIVE_LOCAL_PREFIX) ? projectBase : repoBase;

                const parts = header.name.split(/\//g);
                parts.shift();
                const filename = parts.join(Path.sep);

                try {
                    const dirname = Path.join(baseDir, Path.dirname(filename));
                    if (!dirCache.has(dirname)) {
                        let dirExists = false;
                        try {
                            await FS.stat(dirname);
                            dirExists = true;
                        } catch (e) {}
                        if (!dirExists) {
                            await FS.mkdirp(dirname);
                        }
                        dirCache.add(dirname);
                    }
                    const fileTarget = Path.join(baseDir, filename);
                    stream.on('error', (err) => {
                        reject(err);
                    });
                    stream.on('end', next);

                    stream.pipe(
                        FS.createWriteStream(fileTarget, {
                            mode: header.mode,
                        })
                    );
                } catch (e) {
                    reject(e);
                }
            });

            extractor.on('finish', function () {
                // all entries done - lets finalize it
                console.log('Default providers installed');
                resolve();
            });

            extractor.on('error', function (err) {
                reject(err);
            });

            console.log('Downloading default providers from %s', DEFAULT_PROVIDERS_URL);
            const response = request(DEFAULT_PROVIDERS_URL);
            response.on('error', function (err) {
                reject(err);
            });
            response.pipe(gunzip()).pipe(extractor);
        });
    }
}

export const defaultProviderInstaller = new DefaultProviderInstaller();
