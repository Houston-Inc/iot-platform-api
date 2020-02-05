"use strict";

const Hapi = require("@hapi/hapi");
const path = require("path");

const init = async () => {
    const server = Hapi.server({
        port: process.env.PORT || 3000,
        host: "0.0.0.0"
    });

    await server.register(require("@hapi/inert"));
    await server.register({
        plugin: require('hapi-cors'),
        options: {
            origins: ['*']
        }
    })

    server.route({
        method: "GET",
        path: "/",
        handler: (request, h) => {
            return "Hello World!";
        }
    });

    server.route({
        method: "GET",
        path: "/hello/{name}",
        handler: (request, h) => {
            const name = request.params.name;
            return "Hello " + name;
        }
    });

    server.route({
        method: "GET",
        path: "/chat",
        handler: (request, h) => {
            return h.file(path.join(__dirname, "chat.html"));
        }
    });

    server.route({
        method: "POST",
        path: "/webhook",
        handler: (request, h) => {
            // if (request.query && request.query.validationCode) {
            //     return request.query.validationCode;
            // }

            const base64enc = request.payload.data.body;
            const utf8enc = (new Buffer(base64enc, 'base64')).toString('utf8');
            const reqJson = JSON.parse(utf8enc);
            console.log(reqJson);
            const response = h.response();
            response.code(200);
            return response;
        }
    });

    server.route({
        method: "OPTIONS",
        path: "/webhook",
        handler: (request, h) => {
            console.log(request.headers)
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