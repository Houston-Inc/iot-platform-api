const iotHubTransport = require("azure-iot-device-mqtt").Mqtt;
const Client = require("azure-iot-device").Client;
const IotHubClient = require('azure-iothub').Client;
const crypto = require("crypto");
const ProvisioningTransport = require("azure-iot-provisioning-device-mqtt").Mqtt;
const SymmetricKeySecurityClient = require("azure-iot-security-symmetric-key").SymmetricKeySecurityClient;
const ProvisioningDeviceClient = require("azure-iot-provisioning-device").ProvisioningDeviceClient;

const provisioningHost = process.env.PROVISIONING_HOST;
const idScope = process.env.ID_SCOPE;
const primaryKey = process.env.PRIMARY_KEY;
const serviceConnectionString = process.env.SERVICE_CONNECTION_STRING;
const mockRegister = process.env.MOCKREGISTER;

const EDGE_DEVICE_MODULE = "RuuviTagGateway";
const EDGE_DEVICE_METHOD = "DeviceRegistrationAttempted";
const iotHubClient = IotHubClient.fromConnectionString(serviceConnectionString, iotHubTransport);

const computeDerivedSymmetricKey = (masterKey, regId) => {
    return crypto
        .createHmac("SHA256", Buffer.from(masterKey, "base64"))
        .update(regId, "utf8")
        .digest("base64");
};

class returnObject {
    constructor() {
        this.wasSuccessful = false;
        this.registrationId = null;
        this.edgeDeviceId = null;
        this.message = MESSAGE.DEVICE_REGISTRATION_FAILURE;
    }
}

const MESSAGE = {
    "TWIN_VALUE_FAILURE": "Error retreiving twin value",
    "DEVICE_EXISTS": "Device already exists",
    "DEVICE_REGISTRATION_FAILURE": "Error registering the device",
    "HUB_CONNECTION_ERROR": "Error connecting to IoT Hub",
    "SENDING_HUB_MESSAGE_ERROR": "Error sending message to IoT Hub",
    "DEVICE_DOES_NOT_EXISTS": "IoT or Edge Device does not exists in database or IoT device is already assigned.",
    "GENERIC_SUCCESS": "Registration successful"
}

const registerDevice = async (registrationId, edgeDeviceId) => {
    const baseReturnObject = new returnObject();

    baseReturnObject.registrationId = registrationId;
    baseReturnObject.edgeDeviceId = edgeDeviceId;
    const symmetricKey = computeDerivedSymmetricKey(primaryKey, registrationId);
    const provisioningSecurityClient = new SymmetricKeySecurityClient(registrationId, symmetricKey);
    const provisioningClient = ProvisioningDeviceClient.create(
        provisioningHost,
        idScope,
        new ProvisioningTransport(),
        provisioningSecurityClient
    );

    return new Promise(async (resolve, reject) => {
        if (mockRegister) {
            baseReturnObject.wasSuccessful = true;
            console.log("MOCKING REGISTRATION: ", baseReturnObject);
            invokeDirectMethod(edgeDeviceId, EDGE_DEVICE_MODULE, EDGE_DEVICE_METHOD, baseReturnObject)
                .then(_ => {
                    resolve(baseReturnObject);
                })
                .catch(err => {
                    console.log("error mock register: ", err);
                });
        } else {
            const registerResult = await doRegister(
                provisioningClient,
                baseReturnObject
            );

            console.log("Sending register device");
            invokeDirectMethod(edgeDeviceId, EDGE_DEVICE_MODULE, EDGE_DEVICE_METHOD, registerResult)
                .then(_ => {
                    resolve(registerResult);
                })
                .catch(err => {
                    console.log(err);
                    reject(err);
                });
        }
    });
};

const doRegister = (provisioningClient, baseReturnObject) => {
    return new Promise((resolve, reject) => {
        provisioningClient.register((err, _) => {
            if (err) {
                reject(baseReturnObject);
            } else {
                baseReturnObject.message = MESSAGE.GENERIC_SUCCESS;
                baseReturnObject.wasSuccessful = true;
                resolve(baseReturnObject);
            }
        });
    });
};

const invokeDirectMethod = (edgeDeviceId, moduleId, method, payload) => {
    console.log('Invoking direct method ' + method + ' on device ' + edgeDeviceId);

    const methodParams = {
        methodName: method,
        payload: payload,
        responseTimeoutInSeconds: 30
    };

    return new Promise((resolve, reject) => {
        iotHubClient.invokeDeviceMethod(edgeDeviceId, moduleId, methodParams, function (err, _) {
            if (err) {
                console.error('Failed to invoke method ' + method + ': ' + err.message);
                reject(err);
            } else {
                console.log('Method ' + method + ' invoked succesfully');
                resolve(payload);
            }
        });
    })
}

const sendDeviceDoesNotExist = (registrationId, edgeDeviceId) => {
    const obj = new returnObject();
    obj.message = MESSAGE.DEVICE_DOES_NOT_EXISTS;
    obj.registrationId = registrationId;
    obj.edgeDeviceId = edgeDeviceId

    console.log("Sending device does not exist");
    invokeDirectMethod(edgeDeviceId, EDGE_DEVICE_MODULE, EDGE_DEVICE_METHOD, obj)
        .then(result => {
            console.log(result);
        })
        .catch(err => {
            console.log(err);
        });
}

const sendDeviceRegistrationSuccess = (registrationId, edgeDeviceId) => {
    const obj = new returnObject();
    obj.message = MESSAGE.GENERIC_SUCCESS;
    obj.registrationId = registrationId;
    obj.edgeDeviceId = edgeDeviceId
    obj.wasSuccessful = true;

    console.log("Sending device registration success");
    invokeDirectMethod(edgeDeviceId, EDGE_DEVICE_MODULE, EDGE_DEVICE_METHOD, obj)
        .then(result => {
            console.log(result);
        })
        .catch(err => {
            console.log(err);
        });
}

module.exports = {
    registerDevice,
    sendDeviceDoesNotExist,
    sendDeviceRegistrationSuccess
};