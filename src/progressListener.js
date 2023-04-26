const {spawn} = require("child_process");
const socketManager = require("./socketManager");
/**
 *
 * @type {ProgressListener}
 */
module.exports = {
    run: (command, directory) => {
        socketManager.emit(
            `install`,
            'install:log',
            {
                type: 'info',
                message: `Running command "${command}"`
            }
        );

        return new Promise((resolve, reject) => {
            const child = spawn(command, {
                cwd: directory ? directory : process.cwd(),
                detached: true,
                shell: true
            });

            child.stdout.on('data', (data) => {
                socketManager.emit(`install`, 'install:log', {type: 'info', message: data.toString()});
            });

            child.stderr.on('data', (data) => {
                socketManager.emit(`install`, 'install:log', {type: 'info', message: data.toString()});
            });

            child.on('exit', (exit, signal) => {
                if (exit !== 0) {
                    socketManager.emit(`install`, 'install:log', {type: 'info', message: `"${command}" failed: "${exit}"`});
                    reject(new Error(`Command "${command}" exited with code ${exit}`));
                } else {
                    socketManager.emit(`install`, 'install:log', {type: 'info', message: `Command OK: "${command}"`});
                    resolve({exit, signal});
                }
            });

            child.on('error', (err) => {
                socketManager.emit(`install`, 'install:log', {type: 'info', message: `"${command}" failed: "${err.message}"`});
                reject(err);
            });
        });
    },
    progress: async (label, callback) => {
        socketManager.emit(`install`, 'install:log', {type: 'info', message: `${label}: started`});
        try {
            const result = await callback();
            socketManager.emit(`install`, 'install:log', {type: 'info', message: `${label}: done`});
            return result;
        } catch (e) {
            socketManager.emit(`install`, 'install:log', {type: 'info', message: `${label}: failed. ${e.message}`});
            throw e;
        }
    },
    check: async (message, ok) => {
        const wasOk = await ok;
        socketManager.emit(`install`, 'install:log', {type: 'info', message: `${message}: ${wasOk}`});
    },
    start: (label) => {
        socketManager.emit(`install`, 'install:log', {type: 'info', message: label});
    },
    showValue: (label, value) => {
        socketManager.emit(`install`, 'install:log', {type: 'info', message: `${label}: ${value}`});
    },
    error: (msg, ...args) => {
        socketManager.emit(`install`, 'install:log', {type: 'error', message: msg});
    },
    warn: (msg, ...args) => {
        socketManager.emit(`install`, 'install:log', {type: 'warn', message: msg});
    },
    info: (msg, ...args) => {
        socketManager.emit(`install`, 'install:log', {type: 'info', message: msg});
    },
    debug: (msg, ...args) => {
        socketManager.emit(`install`, 'install:log', {type: 'debug', message: msg});
    },
}