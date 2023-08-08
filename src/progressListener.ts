import { spawn } from '@kapeta/nodejs-process';
import { SocketManager, socketManager } from './socketManager';
class ProgressListener {
    private socketManager: SocketManager;

    constructor(socketManager: SocketManager) {
        this.socketManager = socketManager;
    }

    run(command: string, directory?: string): Promise<{ exit: number; signal: NodeJS.Signals | null }> {
        this.socketManager.emit(`install`, 'install:log', {
            type: 'info',
            message: `Running command "${command}"`,
        });

        return new Promise((resolve, reject) => {
            const child = spawn(command, [],{
                cwd: directory ? directory : process.cwd(),
                detached: true,
                shell: true,
            });

            child.onData((data) => {
                this.socketManager.emit(`install`, 'install:log', { type: 'info', message: data.line });
            });

            child.process.on('exit', (exit, signal) => {
                if (exit !== 0) {
                    this.socketManager.emit(`install`, 'install:log', {
                        type: 'info',
                        message: `"${command}" failed: "${exit}"`,
                    });
                    reject(new Error(`Command "${command}" exited with code ${exit}`));
                } else {
                    this.socketManager.emit(`install`, 'install:log', {
                        type: 'info',
                        message: `Command OK: "${command}"`,
                    });
                    resolve({ exit, signal });
                }
            });

            child.process.on('error', (err) => {
                this.socketManager.emit(`install`, 'install:log', {
                    type: 'info',
                    message: `"${command}" failed: "${err.message}"`,
                });
                reject(err);
            });
        });
    }

    async progress(label: string, callback: () => void | Promise<void>) {
        this.socketManager.emit(`install`, 'install:log', { type: 'info', message: `${label}: started` });
        try {
            const result = await callback();
            this.socketManager.emit(`install`, 'install:log', { type: 'info', message: `${label}: done` });
            return result;
        } catch (e: any) {
            this.socketManager.emit(`install`, 'install:log', {
                type: 'info',
                message: `${label}: failed. ${e.message}`,
            });
            throw e;
        }
    }

    async check(message: string, ok: boolean | Promise<boolean> | (() => Promise<boolean>)) {
        const wasOk = await ok;
        this.socketManager.emit(`install`, 'install:log', { type: 'info', message: `${message}: ${wasOk}` });
    }

    start(label: string) {
        this.socketManager.emit(`install`, 'install:log', { type: 'info', message: label });
    }

    showValue(label: string, value: any) {
        this.socketManager.emit(`install`, 'install:log', { type: 'info', message: `${label}: ${value}` });
    }

    error(msg: string, ...args: any[]) {
        this.socketManager.emit(`install`, 'install:log', { type: 'error', message: msg });
    }

    warn(msg: string, ...args: any[]) {
        this.socketManager.emit(`install`, 'install:log', { type: 'warn', message: msg });
    }

    info(msg: string, ...args: any[]) {
        this.socketManager.emit(`install`, 'install:log', { type: 'info', message: msg });
    }

    debug(msg: string, ...args: any[]) {
        this.socketManager.emit(`install`, 'install:log', { type: 'debug', message: msg });
    }
}

export const progressListener = new ProgressListener(socketManager);
