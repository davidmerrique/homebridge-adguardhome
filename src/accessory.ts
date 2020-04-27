import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
} from "homebridge";

import got, { Got } from "got";

let hap: HAP;

export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("ExampleSwitch", AdGuardHome);
};

class AdGuardHome implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private readonly username: string;
  private readonly password: string;
  private readonly host: string;
  private readonly port: string;
  private readonly gotInstance: Got;
  private switchOn = false;

  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;

    this.username = config["username"];
    this.password = config["password"];
    this.host = config["host"] || "localhost";
    this.port = config["port"] || 80;

    const Authorization = `Basic ${Buffer.from(
      `${this.username}:${this.password}`
    ).toString("base64")}`;

    this.gotInstance = got.extend({
      prefixUrl: "http://" + this.host + ":" + this.port + "/control",
      headers: {
        Authorization,
      },
    });

    this.switchService = new hap.Service.Switch(this.name);
    this.switchService
      .getCharacteristic(hap.Characteristic.On)
      .on(
        CharacteristicEventTypes.GET,
        (callback: CharacteristicGetCallback) => {
          this.gotInstance("status")
            .json()
            .then((body) => {
              log.info(
                "Current state of the switch was returned: " +
                  (this.switchOn ? "ON" : "OFF")
              );
              console.log(body);

              // callback(undefined, body.protection_enabled === true);
            })
            .catch((error) => {
              callback(error);
            });
          // callback(undefined, this.switchOn);
        }
      )
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
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
          log.info(
            "Switch state was set to: " + (this.switchOn ? "ON" : "OFF")
          );
          // callback();
        }
      );

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "AdGuard")
      .setCharacteristic(hap.Characteristic.Model, "AdGuard Home");

    log.info("Switch finished initializing!");
  }

  getServices(): Service[] {
    return [this.informationService, this.switchService];
  }
}

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
