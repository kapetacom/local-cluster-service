import FS from 'node:fs';
import YAML from 'yaml';

export function readYML(path: string) {
    const rawYaml = FS.readFileSync(path);

    try {
        return YAML.parse(rawYaml.toString());
    } catch (err) {
        throw new Error('Failed to parse plan YAML: ' + err);
    }
}

export function isWindows() {
    return 'win32' === process.platform;
}

export function isMac() {
    return 'darwin' === process.platform;
}

export function isLinux() {
    return !isWindows() && !isMac();
}

export function getBindHost(preferredHost = '127.0.0.1') {
    // On Linux we need to bind to 0.0.0.0 to be able to connect to it from docker containers. 
    // TODO: This might pose a security risk - so we should authenticate all requests using a shared secret/nonce that we pass around.
    return isLinux() ? '0.0.0.0' : preferredHost;
}