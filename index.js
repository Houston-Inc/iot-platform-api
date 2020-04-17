"use strict";
require('dotenv').config()

const Hapi = require("@hapi/hapi");
const https = require('https');
const { Pool } = require('pg')

const {registerDevice, sendDeviceDoesNotExist, sendDeviceRegistrationSuccess } = require('./registerDevice');
const io = require('./io')

const server = Hapi.server({
    port: process.env.PORT || 3001,
    host: "0.0.0.0"
});
io.initialize(server);

// Credentials come from env. variable
const pool = new Pool({
    ssl: {
        rejectUnauthorized: true
    }
});

const init = async () => {
    let data = [];
    
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
        path: "/api/telemetry",
        handler: async (request, h) => {
            const payload = typeof request.payload === 'object' ? request.payload : JSON.parse(request.payload);
            const { days, hours, minutes, seconds } = payload.interval; 
            // start should be in the ISO 8601 format. for eg. 2011-10-10T14:48:00
            // TODO : Validation for start and maybe other

            try {
                const sqlRes = await pool.query("SELECT count(*) FROM TELEMETRY WHERE time > NOW() - interval '$1 days $2 hours $3 minutes $4 seconds';", [days, hours, minutes, seconds]); // TODO figure out parameters
                return h.response(sqlRes).code(200);

            } catch (ex) {
                console.log(ex);
                return h.response().code(400);
            }
        }
    });

    server.route({
        method: "POST",
        path: "/webhook/telemetry",
        handler: async (request, h) => {
            console.log("POST: /webhook/telemetry");
            const base64enc = request.payload.data.body;
            const utf8enc = (new Buffer.from(base64enc, 'base64')).toString('utf8');
            const hookData = JSON.parse(utf8enc);
            const {time, address, temperature, humidity, pressure, txpower, rssi, voltage} = hookData;
            const data = {};
            data[address] = {
                telemetry: hookData,
                level: request.payload.data.properties.level,
            };
            io.sendDeviceData(address, data[address]);
            try {
                await pool.query('\
                    INSERT INTO telemetry(time, iot_device_id, temperature, humidity, pressure, txpower, rssi, voltage) \
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [time, address, temperature, humidity, pressure, txpower, rssi, voltage]);
                return h.response().code(200);
            } catch (ex) {
                console.log("ERROR inserting telemetry data:", ex);
                return h.response().code(400);
            }
        }
    });

    server.route({
        method: "POST",
        path: "/webhook/device-registration",
        handler: async (request, h) => {
            console.log("POST: /webhook/device-registration");
            const reqPayload = (process.env.EXEC_ENV === 'azure') ? request.payload : JSON.parse(request.payload);
            const base64enc = reqPayload.data.body;
            const utf8enc = (new Buffer.from(base64enc, 'base64')).toString('utf8');
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
        handler: async (request, h) => {
            let data;
            await pool.query('Select id, address, edge_device_id from iot_devices;')
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
        handler: async (request, h) => {
            const {data} = request.payload;
            const response = h.response();
            try {
                await pool.query("INSERT INTO iot_devices(id) VALUES($1)", [data]);
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
        method: "PUT",
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
                await pool.query("UPDATE iot_devices SET edge_device_id = null WHERE id=$1", [id]);
            }
            catch(ex) {
                response.code(400);
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
                await pool.query("DELETE FROM iot_devices WHERE ID = $1", [id]);
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
        path: "/webhook/device-update",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: async (request, h) => {
            console.log("POST: /webhook/device-update");
            const reqPayload = (process.env.EXEC_ENV === 'azure') ? request.payload : JSON.parse(request.payload);
            const base64enc = reqPayload.data.body;
            const utf8enc = (new Buffer.from(base64enc, 'base64')).toString('utf8');
            const data = JSON.parse(utf8enc);
            const {registrationId, edgeDeviceId} = data;
            const response = h.response();
            try {
                await pool.query("UPDATE iot_devices SET edge_device_id = $1 WHERE id = $2", [edgeDeviceId, registrationId]);
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
        handler: async (request, h) => {
            const {data} = request.payload;
            const response = h.response();

            try {
                await pool.query("INSERT INTO edge_devices(id) VALUES($1)", [data]);
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
                await pool.query("DELETE FROM edge_devices WHERE ID = $1", [id]);
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
        path: "/webhook/{path*}",
        config: {
            cors: {
                "origin": ['*']
            }
        },
        handler: (request, h) => {
            if(request.headers["webhook-request-callback"]){
                console.log("Trying to automatically validate endpoint...");
                console.log(request.headers);

                callValidationUrl(request.headers["webhook-request-callback"])
            }
            const response = h.response();
            response.code(204);
            return response;
        }
    });


    await server.start();
    console.log("Server running on %s", server.info.uri);
};

const callValidationUrl = (callBackUrl) => {
    setTimeout(() => {
        https.get(callBackUrl, (resp) => {
            resp.on('data', () => {
                console.log("Got response from validation url:", callBackUrl);
            });
        }).on("error", (err) => {
            console.log("Error automatically validating the endpoint:", callBackUrl);
            console.log(err.message);
        });
    }, 5000);
}

process.on("unhandledRejection", err => {
    console.log(err);
    process.exit(1);
});

init();