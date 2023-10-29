/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Router from 'express-promise-router';
import { Request, Response } from 'express';

import { corsHandler } from '../middleware/cors';
import { taskManager } from '../taskManager';

const router = Router();

router.use('/', corsHandler);

/**
 * Get all current tasks
 */
router.get('/', (req: Request, res: Response) => {
    res.send(taskManager.list());
});

router.get('/:taskId', (req: Request, res: Response) => {
    const task = taskManager.get(req.params.taskId);
    if (!task) {
        res.status(404).send({ error: 'Task not found' });
        return;
    }

    res.send(task.toData());
});

router.delete('/:taskId', (req: Request, res: Response) => {
    try {
        taskManager.remove(req.params.taskId);
        res.send({ ok: true });
    } catch (e: any) {
        res.status(400).send({ error: e.message });
        return;
    }
});

export default router;
