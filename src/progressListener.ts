/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { spawn } from '@kapeta/nodejs-process';
import { socketManager } from './socketManager';
import { LogEntry } from './types';
import { format } from 'node:util';

export class ProgressListener {
    private readonly systemId: string | undefined;
    private readonly instanceId: string | undefined;

    constructor(systemId?: string, instanceId?: string) {
        this.systemId = systemId;
        this.instanceId = instanceId;
    }

    private emitLog(payload: Omit<LogEntry, 'time' | 'source'>) {
        const logEntry: LogEntry = {
            ...payload,
            source: 'stdout',
            time: Date.now(),
        };
        if (this.systemId && this.instanceId) {
            socketManager.emitInstanceLog(this.systemId, this.instanceId, logEntry);
            return;
        }

        if (this.systemId) {
            socketManager.emitSystemLog(this.systemId, logEntry);
            return;
        }

        socketManager.emitGlobalLog(logEntry);
    }

    run(command: string, directory?: string): Promise<{ exit: number; signal: NodeJS.Signals | null; output: string }> {
        this.info(`Running command "${command}"`);

        return new Promise(async (resolve, reject) => {
            try {
                const chunks: Buffer[] = [];
                const child = spawn(command, [], {
                    cwd: directory ? directory : process.cwd(),
                    shell: true,
                });

                child.onData((data) => {
                    this.emitLog({
                        level: data.type === 'stdout' ? 'INFO' : 'WARN',
                        message: data.line,
                    });
                });

                if (child.process.stdout) {
                    child.process.stdout.on('data', (data) => {
                        chunks.push(data);
                    });
                }

                child.process.on('exit', (exit, signal) => {
                    if (exit !== 0) {
                        this.warn(`Command "${command}" failed: ${exit}`);
                        reject(new Error(`Command "${command}" exited with code ${exit}`));
                    } else {
                        this.info(`Command OK: "${command}"`);
                        resolve({ exit, signal, output: Buffer.concat(chunks).toString() });
                    }
                });

                child.process.on('error', (err) => {
                    this.warn(`"${command}" failed: "${err.message}"`);
                    reject(err);
                });

                await child.wait();
            } catch (e) {
                reject(e);
            }
        });
    }

    async progress(label: string, callback: () => void | Promise<void>) {
        this.info(`${label}: started`);
        try {
            const result = await callback();
            this.info(`${label}: done`);
            return result;
        } catch (e: any) {
            this.warn(`${label}: failed. ${e.message}`);
            throw e;
        }
    }

    async check(message: string, ok: boolean | Promise<boolean> | (() => Promise<boolean>)) {
        const wasOk = await ok;
        this.info(`${message}: ${wasOk}`);
    }

    start(label: string) {
        this.info(label);
    }

    showValue(label: string, value: any) {
        this.info(`${label}: ${value}`);
    }

    error(msg: string, ...args: any[]) {
        this.emitLog({
            message: format(msg, args),
            level: 'ERROR',
        });
    }

    warn(msg: string, ...args: any[]) {
        this.emitLog({
            message: format(msg, args),
            level: 'WARN',
        });
    }

    info(msg: string, ...args: any[]) {
        this.emitLog({
            message: format(msg, args),
            level: 'INFO',
        });
    }

    debug(msg: string, ...args: any[]) {
        this.emitLog({
            message: format(msg, args),
            level: 'DEBUG',
        });
    }
}
