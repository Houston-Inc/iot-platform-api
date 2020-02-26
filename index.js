"use strict";

const Hapi = require("@hapi/hapi");
const SocketIO = require('socket.io');
const {registerDevice, sendDeviceDoesNotExist} = require('./registerDevice');
const { Client } = require('pg')

const init = async () => {
    let data = [];

    const server = Hapi.server({
        port: process.env.PORT || 3001,
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

            let client = new Client();
            await client.connect();
            const addressAvailableSql = await client.query('SELECT i.id FROM iot_devices i WHERE i.id=$1 AND i.edge_device_id IS NULL AND EXISTS(SELECT e.id FROM edge_devices e WHERE e.id=$2);', [data.address, data.edgeDeviceId]);
            if(addressAvailableSql.rows.length === 1) {
                registerDevice(data.address, data.edgeDeviceId).then(async value => {
                    if(value.wasSuccessful) {
                        client = new Client();
                        await client.connect();
                        const res = await client.query('UPDATE iot_devices SET edge_device_id = $1 WHERE id = $2', [value.edgeDeviceId, value.registrationId]);
                        await client.end();
                    }
                });
            } else {
                sendDeviceDoesNotExist();
            }
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

    server.route({
        method: "GET",
        path: "/api/devices",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            const client = new Client({ ssl: true });
            await client.connect();
            const sqlres = await client.query("Select id, address, edge_device_id from iot_devices;");
            await client.end();

            const response = h.response(sqlres.rows);
            response.code(200)
            response.type("application/json");
            return response;
        }
    });

    server.route({
        method: "POST",
        path: "/api/devices",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            const {data} = request.payload;
            const response = h.response();

            //console.log(data);
            try {
                const client = new Client({ ssl: true });
                await client.connect();
                const sqlres = await client.query("INSERT INTO iot_devices(id) VALUES($1)", [data]);
                await client.end();

                //console.log(request.payload);


            }
            catch(ex) {
                console.log(ex);
                if(ex.detail && ex.detail.includes("already exists")) {
                    response.code(409);
                } else {
                    response.code(400);
                }
                return response;
            }
            response.code(200);
            return response;
        }
    });

    server.route({
        method: "DELETE",
        path: "/api/devices",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            const {id} = request.payload;
            const response = h.response();
            try {
                const client = new Client({ ssl: true });
                await client.connect();
                const sqlres = await client.query("DELETE FROM iot_devices WHERE ID = $1", [id]);
                await client.end();
            }
            catch(ex) {
                console.log(ex);
                response.code(400);
                return response;
            }
            response.code(200);
            return response;
        }
    });

    server.route({
        method: "GET",
        path: "/api/edges",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            //return ({ addresses: data.map(({ address }) => address) });
            const client = new Client({ ssl: true });
            await client.connect();
            const sqlres = await client.query("Select id from edge_devices;");
            await client.end();

            const response = h.response(sqlres.rows);
            response.code(200)
            response.type("application/json");
            return response;
        }
    });

    server.route({
        method: "POST",
        path: "/api/edges",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            const {data} = request.payload;
            const response = h.response();

            try {
                const client = new Client({ ssl: true });
                await client.connect();
                const sqlres = await client.query("INSERT INTO edge_devices(id) VALUES($1)", [data]);
                await client.end();
            }
            catch(ex) {
                console.log(ex);
                if(ex.detail && ex.detail.includes("already exists")) {
                    response.code(409);
                } else {
                    response.code(400);
                }
                return response;
            }
            response.code(200);
            return response;
        }
    });


    server.route({
        method: "DELETE",
        path: "/api/edges",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            const {id} = request.payload;
            const response = h.response();
            try {
                const client = new Client({ ssl: true });
                await client.connect();
                const sqlres = await client.query("DELETE FROM edge_devices WHERE ID = $1", [id]);
                await client.end();
            }
            catch(ex) {
                console.log(ex);
                response.code(400);
                return response;
            }
            response.code(200);
            return response;
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