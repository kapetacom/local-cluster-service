import { spawn, hasApp } from '@kapeta/nodejs-process';
import { taskManager } from '../taskManager';

export function hasCLI() {
    return hasApp('kap');
}

export async function ensureCLI() {
    if (!(await hasCLI())) {
        await taskManager
            .add(
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
            )
            .wait();
    }

    await taskManager
        .add(
            `cli:init`,
            () => {
                const process = spawn('npm', ['exec', 'kap', 'init'], {
                    shell: true,
                });

                return process.wait();
            },
            {
                name: `Initializing Kapeta CLI`,
            }
        )
        .wait();
}
