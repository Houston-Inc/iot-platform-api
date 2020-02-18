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

const computeDerivedSymmetricKey = (masterKey, regId) => {
    return crypto
        .createHmac("SHA256", Buffer.from(masterKey, "base64"))
        .update(regId, "utf8")
        .digest("base64");
};

const MESSAGE = {
    "TWIN_VALUE_FAILURE" : "Error retreiving twin value",
    "DEVICE_EXISTS" : "Device already exists",
    "DEVICE_REGISTRATION_FAILURE": "Error registering the device",
    "HUB_CONNECTION_ERROR": "Error connecting to IoT Hub",
    "SENDING_HUB_MESSAGE_ERROR": "Error sending message to IoT Hub",
    "GENERIC_SUCCESS": "Registeration successful"
}

const baseReturnObject = {
    wasSuccessful: false,
    registerationId: null,
    edgeDeviceId: null,
    message: MESSAGE.DEVICE_REGISTRATION_FAILURE,
    deviceTwin: {}
}

let apiDeviceHubClient = Client.fromConnectionString(edgeDeviceConnectionString, iotHubTransport);


const registerDevice = async (registrationId, edgeDeviceId) => {
    baseReturnObject.registerationId = registrationId;
    baseReturnObject.edgeDeviceId = edgeDeviceId;
    const serviceClient = provisioningServiceClient.fromConnectionString(dpsConnectionString);
    const symmetricKey = computeDerivedSymmetricKey(primaryKey, registrationId);
    const provisioningSecurityClient = new SymmetricKeySecurityClient(registrationId, symmetricKey);
    const provisioningClient = ProvisioningDeviceClient.create(
        provisioningHost,
        idScope,
        new ProvisioningTransport(),
        provisioningSecurityClient
    );

    let deviceState;

    serviceClient.getDeviceRegistrationState(registrationId)
        .then(res => {
            const response = baseReturnObject;
            response.message = MESSAGE.DEVICE_EXISTS;
            deviceState = response;
        })
        .catch(async err => {
            console.log("errr?");
            console.log(err.responseBody);
            const error = JSON.parse(err.responseBody);

            if (error.message === "Registration not found.") {
                const registerResult = await doRegister(provisioningClient, symmetricKey);
                console.log("registerresult: ", registerResult);
                deviceState = registerResult;
            } else {
                console.log("err1");
                deviceState = baseReturnObject;
                // return err.responseBody;
            }
        }).finally(()=>{
            sendEventToHub(deviceState)
        });
    return deviceState;
};


const doRegister = (provisioningClient, symmetricKey) => {
    return new Promise((resolve, reject) => {
        provisioningClient.register((err, result) => {
            if (err) {
                console.log("error registering device: " + err);
                reject(baseReturnObject);
            } else {
                console.log("result: ");
                console.log(result);

                const connectionString =
                    "HostName=" +
                    result.assignedHub +
                    ";DeviceId=" +
                    result.deviceId +
                    ";SharedAccessKey=" +
                    symmetricKey;

                hubClient = Client.fromConnectionString(connectionString, iotHubTransport);

                hubClient.open(err => {
                    if (err) {
                        console.error("Could not connect: " + err.message);
                        const response = baseReturnObject;
                        response.message = MESSAGE.HUB_CONNECTION_ERROR;
                        reject(response);
                    } else {
                        // DEVICE TWIN
                        const getTwinPromise = new Promise((resl, rej) => {
                            hubClient.getTwin((err, twin) => {
                                if (err) {
                                    console.error("error getting twin: " + err);
                                    const response = baseReturnObject;
                                    response.message = MESSAGE.TWIN_VALUE_FAILURE;
                                    rej(response);
                                }
                                // Output the current properties
                                console.log("Device twin content:");
                                console.log(twin.properties);
                                const response = baseReturnObject;
                                response.message = MESSAGE.GENERIC_SUCCESS;
                                response.wasSuccessful = true;
                                response.deviceTwin = twin.properties.desired;
                                resl(response);
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
    const message = new Message(JSON.stringify(deviceState));
    message.properties.add("type", "DeviceRegistrationAttempted");
    apiDeviceHubClient.sendEvent(message, (err, res) => {
        if (err) {
            console.log(
                "Error sending registration message: " + err.toString()
            );
            const response = baseReturnObject;
            response.message = MESSAGE.SENDING_HUB_MESSAGE_ERROR;
        }

        if (res) {
            console.log("Sent registration message", res);
            const response = baseReturnObject;
            response.message = MESSAGE.GENERIC_SUCCESS;
            response.wasSuccessful = true;
        }
        apiDeviceHubClient.close();                            
    })
}

module.exports = registerDevice;