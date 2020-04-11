const sio = require('socket.io');

let io = null;
const ids = new Map();
exports.get = function() {
    return io;
}

exports.initialize = function(server) {
    io = sio.listen(server.listener);
    io.on('connection', (socket) => {
        console.log(`A user conected with ${socket.id}`);
        socket.on('UPDATE_DEVICE_SELECTION', (data) => {
            console.log(`UPDATE DEVICE SELECTION by socket id ${socket.id} for device ${data.deviceId}`);
            data.prop === "ADD" && ids.set(socket.id, data.deviceId);
            data.prop === "REMOVE" && ids.delete(socket.id);
        })
        socket.on('disconnect', () => {
            console.log(`User disconnected ${socket.id}`);
        })
    })
}

exports.sendDeviceData = function(currentDevice, data) {
    for (const [socketId, deviceId] of ids.entries()) {
        if(deviceId === currentDevice) {
            console.log('SENDING DEVICE DATA of ', currentDevice);
            io.to(socketId).emit('DEVICE_DATA', data);
        }
    }
}
