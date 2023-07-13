import _ from 'lodash';
import {Socket, Server} from "socket.io";

export class SocketManager {
    private _io: Server|null;
    private _sockets: Socket[];

    constructor() {
        this._io = null;
        this._sockets = [];
        return this;
    }

    setIo(io:Server) {
        console.log("Socket server ready");
        this._io = io;

        this._bindIO();
    }

    private get io() {
        if (!this._io) {
            throw new Error("Socket server not ready");
        }
        return this._io;
    }

    emit(context:string, type:string, payload:any) {
        this.io.to(context).emit(type, {context, payload});
    }

    _bindIO() {
        this.io.on('connection', (socket) => this._handleSocketCreated(socket))
    }

    _handleSocketCreated(socket:Socket) {
        this._bindSocket(socket);
        this._sockets.push(socket);
    }

    _bindSocket(socket:Socket) {
        socket.on('disconnect', () => this._handleSocketDestroyed(socket))
        socket.on('join', (id) => {
            console.log("socket joined ", id);
            socket.join(id);
        })
        socket.on('leave', (id) => {
            console.log("socket left ", id);
            socket.leave(id);
        })
    }

    _handleSocketDestroyed(socket:Socket) {
        _.pull(this._sockets, socket);
    }

}
export const socketManager = new SocketManager();