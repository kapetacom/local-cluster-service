
const _ = require('lodash');

class SocketManager {

    constructor() {
        this._io = null;
        this._sockets = [];
        return this;
    }

    getName() {
        return this.name;
    }

    setIo(io) {
        console.log("socket ready");
        this._io = io;

        this._bindIO();
    }

    emit(context, type, payload) {
        console.log("emit", context, type, payload);


        this._io.to(context).emit(type, payload);
    }

    _bindIO() {
        this._io.on('connection', (socket) => this._handleSocketCreated(socket))
    }

    _handleSocketCreated(socket) {
        this._bindSocket(socket);
        this._sockets.push(socket);
    }

    _bindSocket(socket) {
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

    _handleSocketDestroyed(socket) {
        _.pull(this._sockets, socket);
    }

}


module.exports = new SocketManager();
