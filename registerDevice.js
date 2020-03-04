const iotHubTransport = require("azure-iot-device-mqtt").Mqtt;
const Client = require("azure-iot-device").Client;
const Message = require("azure-iot-device").Message;
const crypto = require("crypto");
const ProvisioningTransport = require("azure-iot-provisioning-device-mqtt").Mqtt;
const SymmetricKeySecurityClient = require("azure-iot-security-symmetric-key")
    .SymmetricKeySecurityClient;
const ProvisioningDeviceClient = require("azure-iot-provisioning-device").ProvisioningDeviceClient;
const provisioningServiceClient = require("azure-iot-provisioning-service")
    .ProvisioningServiceClient;

const { provisioningHost, idScope, primaryKey, dpsConnectionString, edgeDeviceConnectionString } = require("./dpsSettings.json");

const mockRegister = process.env.MOCKREGISTER;

const computeDerivedSymmetricKey = (masterKey, regId) => {
    return crypto
        .createHmac("SHA256", Buffer.from(masterKey, "base64"))
        .update(regId, "utf8")
        .digest("base64");
};

class returnObject {
    constructor(){
        this.wasSuccessful = false;
        this.registrationId = null;
        this.edgeDeviceId = null;
        this.message = MESSAGE.DEVICE_REGISTRATION_FAILURE;
        this.deviceTwin = {};
    }
}

const MESSAGE = {
    "TWIN_VALUE_FAILURE" : "Error retreiving twin value",
    "DEVICE_EXISTS" : "Device already exists",
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

    return new Promise( async(resolve, reject) => {
        if (mockRegister) {
            baseReturnObject.wasSuccessful = true;
            console.log("MOCKING REGISTRATION: ", baseReturnObject);
            const eventToHub = sendEventToHub(baseReturnObject);
            eventToHub
                .then(dState => {
                    resolve(baseReturnObject);
                })
                .catch(err => {
                    console.log("error mock register: ", err);
                });
        } else {
            const registerResult = await doRegister(
                provisioningClient,
                symmetricKey,
                baseReturnObject
            );
            const eventToHub = sendEventToHub(registerResult);
            eventToHub
                .then(deviceState => {
                    resolve(deviceState);
                })
                .catch(err => {});

        }
    });
};


const doRegister = (provisioningClient, symmetricKey, baseReturnObject) => {
    return new Promise((resolve, reject) => {
        provisioningClient.register((err, result) => {
            if (err) {
                reject(baseReturnObject);
            } else {

                
                //TODO DO DATABASE UPDATE HERE

                
                const connectionString =
                    "HostName=" +
                    result.assignedHub +
                    ";DeviceId=" +
                    result.deviceId +
                    ";SharedAccessKey=" +
                    symmetricKey;
                const hubClient = Client.fromConnectionString(connectionString, iotHubTransport);
                hubClient.open(err => {
                    if (err) {
                        baseReturnObject.message = MESSAGE.HUB_CONNECTION_ERROR;
                        reject(baseReturnObject);
                    } else {
                        // DEVICE TWIN
                        const getTwinPromise = new Promise((resl, rej) => {
                            hubClient.getTwin((err, twin) => {
                                if (err) {
                                    console.error("error getting twin: " + err);
                                    baseReturnObject.message = MESSAGE.TWIN_VALUE_FAILURE;
                                    rej(baseReturnObject);
                                }
                                // Output the current properties
                                console.log("Device twin content:");
                                console.log(twin.properties);
                                baseReturnObject.message = MESSAGE.GENERIC_SUCCESS;
                                baseReturnObject.wasSuccessful = true;
                                baseReturnObject.deviceTwin = twin.properties.desired;
                                resl(baseReturnObject);
                            });
                        });

                        getTwinPromise.then((getTwin) => { 
                            hubClient.close();
                            resolve(getTwin); 
                        })
                    }
                });
            }
        });
    });
};


const sendEventToHub = (deviceState) => {
    console.log('send event to hub with the device state : ', deviceState);
    const apiDeviceHubClient = Client.fromConnectionString(edgeDeviceConnectionString, iotHubTransport);
    const message = new Message(JSON.stringify(deviceState));
    message.properties.add("type", "DeviceRegistrationAttempted");

    return new Promise((resolve, reject) => {
        apiDeviceHubClient.sendEvent(message, (err, res) => {
            if (err) {
                console.log("Error sending registration message: " + err.toString());
                reject(err);
            }
            console.log("going to resolve sendEventToHub");
            resolve(deviceState);
        })
    });
}
const sendDeviceDoesNotExist = (registrationId, edgeDeviceId) => {
    const obj = new returnObject();
    obj.message = MESSAGE.DEVICE_DOES_NOT_EXISTS;
    obj.registrationId = registrationId;
    obj.edgeDeviceId = edgeDeviceId
    sendEventToHub(obj);
}


const sendDeviceRegistrationSuccess = (registrationId, edgeDeviceId) => {
    const obj = new returnObject();
    obj.message = MESSAGE.GENERIC_SUCCESS;
    obj.registrationId = registrationId;
    obj.edgeDeviceId = edgeDeviceId
    obj.wasSuccessful = true;
    sendEventToHub(obj);
}

module.exports = {
    registerDevice,
    sendDeviceDoesNotExist,
    sendDeviceRegistrationSuccess
};