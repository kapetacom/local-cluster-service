import _ from 'lodash';
import { Socket, Server } from 'socket.io';
import { normalizeKapetaUri } from './utils/utils';
import { LogEntry } from './types';
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
            socketManager.emit(`${systemId}/instances`, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    emitInstanceLog(systemId: string, instanceId: string, payload: LogEntry) {
        this.emitInstanceEvent(systemId, instanceId, EVENT_INSTANCE_LOG, payload);
    }

    emitSystemLog(systemId: string, payload: LogEntry) {
        this.emitSystemEvent(systemId, EVENT_SYSTEM_LOG, payload);
    }

    emitGlobalLog(payload: LogEntry) {
        this.emitGlobal(EVENT_LOG, payload);
    }

    emitInstanceEvent(systemId: string, instanceId: string, type: string, payload: any) {
        systemId = normalizeKapetaUri(systemId);
        try {
            socketManager.emit(`${systemId}/instances/${instanceId}`, type, payload);
        } catch (e: any) {
            console.warn('Failed to emit instance event: %s', e.message);
        }
    }

    private _bindIO() {
        this.io.on('connection', (socket) => this._handleSocketCreated(socket));
    }

    private _handleSocketCreated(socket: Socket) {
        this._bindSocket(socket);
        this._sockets.push(socket);
    }

    private _bindSocket(socket: Socket) {
        socket.on('disconnect', () => this._handleSocketDestroyed(socket));
        socket.on('join', (id) => {
            socket.join(id);
        });
        socket.on('leave', (id) => {
            socket.leave(id);
        });
    }

    private _handleSocketDestroyed(socket: Socket) {
        _.pull(this._sockets, socket);
    }
}
export const socketManager = new SocketManager();
