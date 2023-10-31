/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import { spawn, hasApp } from '@kapeta/nodejs-process';
import { taskManager } from '../taskManager';

export async function hasCLI() {
    return hasApp('kap');
}

export async function ensureCLI() {
    if (await hasCLI()) {
        return null;
    }

    return taskManager.add(
        `cli:install`,
        () => {
            const process = spawn('npm', ['install', '-g', '@kapeta/kap'], {
                shell: true,
            });

            return process.wait();
        },
        {
            name: `Installing Kapeta CLI`,
        }
    );
}

export async function hasCLICommand(command: string) {
    return hasApp(`kap ${command}`);
}

export async function ensureCLICommands(commands: string | string[]) {
    const commandsArray = Array.isArray(commands) ? commands : [commands];

    const checkCommands = await Promise.all(commandsArray.map(hasCLICommand));

    if (checkCommands.includes(false)) {
        return taskManager.add(
            'kap:init',
            () => {
                const process = spawn('kap', ['init'], { shell: true });
                return process.wait();
            },
            {
                name: 'Running `kap init` to install default CLI commands',
            }
        );
    } else {
        return null;
    }
}
