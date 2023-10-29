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
