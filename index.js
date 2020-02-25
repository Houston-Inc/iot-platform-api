"use strict";

const Hapi = require("@hapi/hapi");
const SocketIO = require('socket.io');
const registerDevice = require('./registerDevice');
const { Client } = require('pg')

/*
const config = {
    host: 'iot-platform-postgresql.postgres.database.azure.com',
    // Do not hard code your username and password.
    // Consider using Node environment variables.
    user: 'psql_user@iot-platform-postgresql',     
    password: 'generic_password',
    database: 'iot',
    port: 5432,
    ssl: true
};
*/
const init = async () => {
    let data = [];

    const server = Hapi.server({
        port: process.env.PORT || 3000,
        host: "0.0.0.0"
    });

    const io = SocketIO.listen(server.listener);

    io.sockets.on('connection', (socket) => {
        socket.emit('sensorData', {
            data
        })
        data.forEach(d => {
            socket.emit(d.address, {
                temperature: d.temperature,
                humidity: d.humidity,
                pressure: d.pressure,
            })
        });
    });

    server.route({
        method: "GET",
        path: "/",
        handler: (request, h) => {
            console.log('Get API');
            return "api";
        }
    });

    server.route({
        method: "GET",
        path: "/addresses",
        handler: (request, reply) => {
            "use strict";
            return ({ addresses: data.map(({ address }) => address) });
        }
    });

    server.route({
        method: "POST",
        path: "/webhook",
        handler: (request, h) => {
            const base64enc = request.payload.data.body;
            const utf8enc = (new Buffer(base64enc, 'base64')).toString('utf8');
            const hookData = JSON.parse(utf8enc);
            data = hookData;

            io.emit('sensorData', {
                data: hookData
            })
            /*
            hookData.forEach(data => {
                io.emit(data.address, {
                    data
                })
            });*/
            const response = h.response();
            response.code(200);
            return response;
        }
    });

    server.route({
        method: "OPTIONS",
        path: "/webhook",
        handler: (request, h) => {
            // console.log("--- WEBHOOK OPTIONS:")
            // console.log("--- HEADERS:")
            // console.log(request.headers)
            // console.log("--- PAYLOAD:")
            // console.log(request.payload)
            return h.response().code(200);
        }
    });

    server.route({
        method: "POST",
        path: "/device-registration",
        handler: async (request, h) => {
            const reqPayload = (process.env.EXEC_ENV === 'azure') ? request.payload : JSON.parse(request.payload);
            const base64enc = reqPayload.data.body;
            const utf8enc = (new Buffer(base64enc, 'base64')).toString('utf8');
            const data = JSON.parse(utf8enc);
            let client = new Client(config);
            try {
                await client.connect();
                const res = await client.query('INSERT INTO edge_devices(id) values($1)', [data.edgeDeviceId]);
            } catch(ex) {
                console.log(ex);
            } finally {
                await client.end();
            }
            
            registerDevice(data.address, data.edgeDeviceId).then(async value => {
                if(value.wasSuccessful) {
                    client = new Client();
                    await client.connect();
                    const res = await client.query('INSERT INTO iot_devices(id, edge_device_id) values($1, $2)', [value.registrationId, value.edgeDeviceId]);
                    await client.end();
                }
            });
            return h.response().code(200);
        }
    });

    server.route({
        method: "OPTIONS",
        path: "/device-registration",
        handler: (request, h) => {
            // console.log("--- HEADERS:")
            console.log("--- device-registration OPTIONS:")
            console.log(request.headers)
            // console.log("--- PAYLOAD:")
            // console.log(request.payload)
            return h.response().code(200);
        }
    });

    await server.start();
    console.log("Server running on %s", server.info.uri);
};

process.on("unhandledRejection", err => {
    console.log(err);
    process.exit(1);
});

init();