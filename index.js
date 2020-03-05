"use strict";

const Hapi = require("@hapi/hapi");
const https = require('https');
const SocketIO = require('socket.io');
const {registerDevice, sendDeviceDoesNotExist, sendDeviceRegistrationSuccess } = require('./registerDevice');
const { Client, Pool } = require('pg')

// Credentials come from env. variable
const pool = new Pool({ ssl: true });

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
    });

    server.route({
        method: "GET",
        path: "/",
        handler: (request, h) => {
            return "api";
        }
    });

    server.route({
        method: "GET",
        path: "/addresses",
        handler: (request, reply) => {
            return ({ addresses: data.map(({ address }) => address) });
        }
    });

    server.route({
        method: "POST",
        path: "/telemetry",
        handler: (request, h) => {
            const base64enc = request.payload.data.body;
            const utf8enc = (new Buffer(base64enc, 'base64')).toString('utf8');
            const hookData = JSON.parse(utf8enc);
            const {time, address, temperature, humidity, pressure, txpower, rssi, voltage} = hookData;

            io.emit('sensorData', {
                data: hookData
            });

            try {
                pool.query('\
                    INSERT INTO telemetry(time, iot_device_id, temperature, humidity, pressure, txpower, rssi, voltage) \
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [time, address, temperature, humidity, pressure, txpower, rssi, voltage]);
            } catch (ex) {
                console.log("ERROR inserting telemetry data:", ex);
            }

            const response = h.response();
            response.code(200);
            return response;
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

            const addressAvailableSql = await pool.query('\
                SELECT 1 FROM iot_devices i WHERE i.id=$1 AND i.edge_device_id IS NULL AND EXISTS(SELECT e.id FROM edge_devices e WHERE e.id=$2);', 
                [data.address, data.edgeDeviceId]);
            if(addressAvailableSql.rows.length === 1) {
                registerDevice(data.address, data.edgeDeviceId).then(async value => {
                    console.log('After registering the device with the callback, the returned values is ', value);
                    console.log('updating the iot_device in the db');
                    if(value.wasSuccessful) {
                        await pool.query('UPDATE iot_devices SET edge_device_id = $1 WHERE id = $2', [value.edgeDeviceId, value.registrationId]);
                    }
                });
            } else {
                const idsMatch = await pool.query('SELECT 1 FROM iot_devices i WHERE i.id=$1 and i.edge_device_id=$2', [data.address, data.edgeDeviceId]);
                if(idsMatch.rows.length === 1) {
                    sendDeviceRegistrationSuccess(data.address, data.edgeDeviceId);
                } else {
                    sendDeviceDoesNotExist(data.address, data.edgeDeviceId);
                }
            }
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
        handler: (request, h) => {
            let data;
            pool.query('Select id, address, edge_device_id from iot_devices;')
                .then(res => {
                    //response = h.response(res.rows);
                    data = res.rows;
                })
                .catch(err => {
                    //response.data()
                });
            const response = h.response(data);
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
        handler: (request, h) => {
            const {data} = request.payload;
            const response = h.response();
            try {
                pool.query("INSERT INTO iot_devices(id) VALUES($1)", [data]);
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
        handler: (request, h) => {
            const {id} = request.payload;
            const response = h.response();
            try {
                pool.query("DELETE FROM iot_devices WHERE ID = $1", [id]);
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
        method: "POST",
        path: "/api/device-update",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: (request, h) => {
            const reqPayload = (process.env.EXEC_ENV === 'azure') ? request.payload : JSON.parse(request.payload);
            const base64enc = reqPayload.data.body;
            const utf8enc = (new Buffer(base64enc, 'base64')).toString('utf8');
            const data = JSON.parse(utf8enc);
            const {registrationId, edgeDeviceId} = data;
            const response = h.response();
            try {
                pool.query("UPDATE iot_devices SET edge_device_id = $1 WHERE id = $2", [edgeDeviceId, registrationId]);
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
            const sqlres = await pool.query("Select id from edge_devices;");

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
        handler: (request, h) => {
            const {data} = request.payload;
            const response = h.response();

            try {
                pool.query("INSERT INTO edge_devices(id) VALUES($1)", [data]);
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
        handler: (request, h) => {
            const {id} = request.payload;
            const response = h.response();
            try {
                pool.query("DELETE FROM edge_devices WHERE ID = $1", [id]);
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

    // AUTOMATIC VALIDATION for all Azure IoT Hub Event Subscription endpoints
    server.route({
        method: "OPTIONS",
        path: "/api/{path*}",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: (request, h) => {
            if(request.headers["webhook-request-callback"]){
                console.log("Trying to automatically validate endpoint...");
                https.get(request.headers["webhook-request-callback"], (resp) => {
                    resp.on('end', () => {
                        console.log("AUTOMATIC VALIDATION DONE");
                    });
                }).on("error", (err) => {
                    console.log("Error automatically validating the endpoint");
                    console.log("Error: " + err.message);
                    console.log(request.headers);
                });
            }
            const response = h.response();
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