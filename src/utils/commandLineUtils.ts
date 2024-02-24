/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { spawn, hasApp } from '@kapeta/nodejs-process';
import { Task, taskManager } from '../taskManager';

export async function hasCLI() {
    return hasApp('kap');
}

export async function ensureCLI() {
    if (await hasCLI()) {
        return null;
    }

    return taskManager.add(
        `cli:install`,
        (task: Task) => {
            const process = spawn('npm', ['install', '-g', '@kapeta/kap'], {
                shell: true,
            });

            process.process.stdout?.on('data', (data: any) => {
                task.addLog(data.toString(), 'INFO');
            });

            process.process.stderr?.on('data', (data: any) => {
                task.addLog(data.toString(), 'ERROR');
            });

            return process.wait();
        },
        {
            name: `Installing Kapeta CLI`,
        }
    );
}

export function ensureCLICommands() {
    console.log('Run `kap init` to ensure default commands are installed');
    const process = spawn('kap', ['init'], { shell: true });
    return process.wait();
}
