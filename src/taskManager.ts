/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Class that handles processing background tasks.
 */
import { socketManager } from './socketManager';

const EVENT_TASK_UPDATED = 'task-updated';
const EVENT_TASK_ADDED = 'task-added';
const EVENT_TASK_REMOVED = 'task-removed';

export type TaskRunner<T> = (task: Task<T>) => Promise<T>;

export enum TaskStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

interface Future<T = void> {
    promise: Promise<T>;
    resolve: (result: T) => void;
    reject: (e: any) => void;
}

interface TaskMetadata {
    name: string;
    /**
     * A unique prefix for the task. If defined only 1 task with this ID prefix will be executed at a time
     */
    group?: string;
    progress?: number;

    [key: string]: any;
}

interface TaskData<T = void> {
    id: string;
    status: TaskStatus;
    errorMessage?: string;
    metadata: TaskMetadata;
    future: Future<T>;
    run: TaskRunner<T>;
}

export class Task<T = void> implements TaskData<T> {
    private data: TaskData<T>;

    constructor(task: TaskData<T>) {
        this.data = task;
    }

    get id() {
        return this.data.id;
    }

    get status() {
        return this.data.status;
    }

    get errorMessage() {
        return this.data.errorMessage;
    }

    get metadata() {
        return this.data.metadata;
    }

    get future() {
        return this.data.future;
    }

    get run() {
        return this.data.run;
    }

    set status(status: TaskStatus) {
        this.data.status = status;
    }

    set errorMessage(errorMessage: string | undefined) {
        this.data.errorMessage = errorMessage;
    }

    set metadata(metadata: TaskMetadata) {
        this.data.metadata = metadata;
    }

    public emitUpdate() {
        socketManager.emitGlobal(EVENT_TASK_UPDATED, this.toData());
    }

    async wait(): Promise<T> {
        return this.future.promise;
    }

    toData() {
        return { ...this.data };
    }
}

function createFuture<T>(): Future<T> {
    let resolve: (arg: T) => void = () => {};
    let reject: () => void = () => {};
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    // Ignore unhandled promise rejections
    promise.catch(() => {});

    return {
        promise,
        resolve,
        reject,
    };
}

class TaskManager {
    private _tasks: Task<any>[] = [];

    public add<T>(id: string, runner: TaskRunner<T>, metadata: TaskMetadata): Task<T> {
        const existingTask = this.get(id);
        if (existingTask) {
            return existingTask;
        }

        const future = createFuture<T>();

        const task = new Task<T>({
            id,
            status: TaskStatus.PENDING,
            metadata,
            future,
            run: runner,
        });

        this._tasks.push(task);

        socketManager.emitGlobal(EVENT_TASK_ADDED, task.toData());

        this.invokeTask(task).catch((err) => {
            console.warn(`Task ${task.id} failed`, err);
        });

        return task;
    }

    async waitFor(filter: (task: Task<any>) => boolean) {
        const tasks = this._tasks.filter(filter);
        while (tasks.length > 0) {
            const task = tasks.shift();
            if (!task) {
                continue;
            }
            try {
                await task.wait();
            } catch (e) {
                //Ignore
            }
        }
    }

    public get(taskId: string) {
        return this._tasks.find((t) => t.id === taskId);
    }

    public exists(taskId: string) {
        return !!this.get(taskId);
    }

    public remove(taskId: string) {
        const task = this.get(taskId);
        if (!task) {
            return;
        }

        if (task.status === TaskStatus.RUNNING) {
            throw new Error('Cannot remove a running task');
        }

        this._tasks = this._tasks.filter((t) => t.id !== taskId);
        socketManager.emitGlobal(EVENT_TASK_REMOVED, task.toData());
    }

    public list(): TaskData[] {
        return this._tasks.map((t) => t.toData());
    }

    private async invokeTask(task: Task<any>): Promise<void> {
        if (task.metadata.group) {
            const existingTaskInGroup = this._tasks.find(
                (t) => t.id !== task.id && t.metadata.group === task.metadata.group && t.status === TaskStatus.RUNNING
            );

            if (existingTaskInGroup) {
                return;
            }
        }

        const startTime = Date.now();
        try {
            task.status = TaskStatus.RUNNING;
            task.emitUpdate();
            const result = await task.run(task);
            task.status = TaskStatus.COMPLETED;
            task.future.resolve(result);
            task.emitUpdate();
        } catch (e: any) {
            console.warn(`Task ${task.id} failed while waiting for it to resolve`, e);
            task.errorMessage = e.message;
            task.status = TaskStatus.FAILED;
            task.future.reject(e);
            task.emitUpdate();
        } finally {
            this.remove(task.id);
            console.log(`Task ${task.id} completed in ${Date.now() - startTime}ms`);
        }

        if (task.metadata.group) {
            const nextTaskInGroup = this._tasks.find(
                (t) => t.id !== task.id && t.metadata.group === task.metadata.group && t.status === TaskStatus.PENDING
            );
            if (nextTaskInGroup) {
                return this.invokeTask(nextTaskInGroup);
            }
        }
    }
}

export const taskManager = new TaskManager();
