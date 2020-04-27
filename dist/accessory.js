"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const got_1 = __importDefault(require("got"));
let hap;
class AdGuardHome {
    constructor(log, config, api) {
        this.switchOn = false;
        this.log = log;
        this.name = config.name;
        this.username = config["username"];
        this.password = config["password"];
        this.host = config["host"] || "localhost";
        this.port = config["port"] || 80;
        const Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
        this.gotInstance = got_1.default.extend({
            prefixUrl: "http://" + this.host + ":" + this.port + "/control",
            headers: {
                Authorization,
            },
        });
        this.switchService = new hap.Service.Switch(this.name);
        this.switchService
            .getCharacteristic(hap.Characteristic.On)
            .on("get" /* GET */, (callback) => {
            this.gotInstance("status")
                .json()
                .then((body) => {
                log.info("Current state of the switch was returned: " +
                    (this.switchOn ? "ON" : "OFF"));
                console.log(body);
                // callback(undefined, body.protection_enabled === true);
            })
                .catch((error) => {
                callback(error);
            });
            // callback(undefined, this.switchOn);
        })
            .on("set" /* SET */, (value, callback) => {
            this.gotInstance
                .post("dns_config", {
                json: {
                    protection_enabled: !!value,
                },
            })
                .then((res) => {
                callback(null, res.statusCode === 200);
            })
                .catch((error) => {
                callback(error);
            });
            // this.switchOn = value as boolean;
            log.info("Switch state was set to: " + (this.switchOn ? "ON" : "OFF"));
            // callback();
        });
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "AdGuard")
            .setCharacteristic(hap.Characteristic.Model, "AdGuard Home");
        log.info("Switch finished initializing!");
    }
    getServices() {
        return [this.informationService, this.switchService];
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerAccessory("ExampleSwitch", AdGuardHome);
};
// var Service, Characteristic;
// module.exports = function (homebridge) {
//   Service = homebridge.hap.Service;
//   Characteristic = homebridge.hap.Characteristic;
//   homebridge.registerAccessory("homebridge-adguard", "AdGuardHome", adguard);
// };
// function adguard(log, config) {
//   this.log = log;
//   global.log = log;
//   this.manufacturer = "AdGuard";
//   this.name = config["name"] || "AdGuardHome";
//   this.username = config["username"];
//   this.password = config["password"];
//   this.host = config["host"] || "localhost";
//   this.port = config["port"] || 80;
//   const Authorization = `Basic ${Buffer.from(
//     `${this.username}:${this.password}`
//   ).toString("base64")}`;
//   this.gotInstance = got.extend({
//     prefixUrl: "http://" + this.host + ":" + this.port + "/control",
//     headers: {
//       Authorization,
//     },
//     responseType: "json",
//   });
// }
// adguard.prototype.getServices = function () {
//   var infoService = new Service.AccessoryInformation()
//     .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
//     .setCharacteristic(Characteristic.Model, this.model)
//     .setCharacteristic(Characteristic.SerialNumber, this.serial);
//   var switchService = new Service.Switch(this.name);
//   switchService
//     .getCharacteristic(Characteristic.On)
//     .on("get", this.getStatus.bind(this))
//     .on("set", this.setStatus.bind(this));
//   this.informationService = infoService;
//   this.switchService = switchService;
//   return [this.informationService, this.switchService];
// };
// adguard.prototype.getStatus = function (callback) {
//   this.gotInstance("status")
//     .then(({ body }) => {
//       callback(null, body.protection_enabled === true);
//     })
//     .catch((error) => {
//       callback(error);
//     });
// };
// adguard.prototype.setStatus = function (newVal, callback) {
//   this.gotInstance
//     .post("dns_config", {
//       json: {
//         protection_enabled: !!newVal,
//       },
//     })
//     .then((res) => {
//       callback(null, res.status === 200);
//     })
//     .catch((error) => {
//       callback(error);
//     });
// };
//# sourceMappingURL=accessory.js.map