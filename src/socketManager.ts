/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import _ from 'lodash';
import { Socket, Server } from 'socket.io';
import { normalizeKapetaUri } from '@kapeta/nodejs-utils';
import { LogEntry } from './types';
import { containerManager } from './containerManager';
export const EVENT_STATUS_CHANGED = 'status-changed';
export const EVENT_INSTANCE_CREATED = 'instance-created';
export const EVENT_INSTANCE_EXITED = 'instance-exited';
export const EVENT_INSTANCE_LOG = 'instance-log';

export const EVENT_SYSTEM_LOG = 'system-log';
export const EVENT_LOG = 'log';

export class SocketManager {
    private _io: Server | null;
    private readonly _sockets: Socket[];

    constructor() {
        this._io = null;
        this._sockets = [];
        return this;
    }

    setIo(io: Server) {
        this._io = io;
        this._bindIO();
    }

    isAlive() {
        return !!this._io;
    }

    private get io() {
        if (!this._io) {
            throw new Error('Socket server not ready');
        }
        return this._io;
    }

    emit(context: string, type: string, payload: any) {
        if (!this._io) {
            return;
        }
        this.io.to(context).emit(type, { context, payload });
    }

    emitGlobal(type: string, payload: any) {
        if (!this._io) {
            return;
        }
        this.io.emit(type, payload);
    }

    emitSystemEvent(systemId: string, type: string, payload: any) {
        systemId = normalizeKapetaUri(systemId);
        try {
            const contextId = `system-events/${encodeURIComponent(systemId)}`;
            this.emit(contextId, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    emitInstanceLog(systemId: string, instanceId: string, payload: LogEntry) {
        systemId = normalizeKapetaUri(systemId);
        try {
            this.emit(
                `instance-logs/${encodeURIComponent(systemId)}/${encodeURIComponent(instanceId)}`,
                EVENT_INSTANCE_LOG,
                payload
            );
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    emitSystemLog(systemId: string, payload: LogEntry) {
        this.emitSystemEvent(systemId, EVENT_SYSTEM_LOG, payload);
    }

    emitGlobalLog(payload: LogEntry) {
        this.emitGlobal(EVENT_LOG, payload);
    }

    private _bindIO() {
        this.io.on('connection', (socket) => this._handleSocketCreated(socket));
    }

    private _handleSocketCreated(socket: Socket) {
        this._bindSocket(socket);
        this._sockets.push(socket);
    }

    private _bindSocket(socket: Socket) {
        socket.on('disconnect', () => {
            _.pull(this._sockets, socket);
            socket.rooms.forEach((roomId) => {
                this.handleLeaveRoom(roomId);
            });
        });
        socket.on('join', (id) => {
            socket.join(id);
            this.handleJoinRoom(id);
        });
        socket.on('leave', (id) => {
            socket.leave(id);
            this.handleLeaveRoom(id);
        });
    }
    private handleJoinRoom(id: string) {
        if (id.startsWith('instance-logs/')) {
            let [, systemId, instanceId] = id.split(/\//g);
            systemId = decodeURIComponent(systemId);
            instanceId = decodeURIComponent(instanceId);
            console.log('Start listening for logs', systemId, instanceId);
            containerManager
                .ensureLogListening(systemId, instanceId, (log) => {
                    this.emitInstanceLog(systemId, instanceId, log);
                })
                .catch((e) => {});
        }
    }
    private handleLeaveRoom(id: string) {
        if (id.startsWith('instance-logs/')) {
            let [, systemId, instanceId] = id.split(/\//g);
            systemId = decodeURIComponent(systemId);
            instanceId = decodeURIComponent(instanceId);
            console.log('Stop listening for logs', systemId, instanceId);
            containerManager.stopLogListening(systemId, instanceId).catch((e) => {});
        }
    }
}
export const socketManager = new SocketManager();
