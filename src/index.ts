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
  api.registerAccessory("homebridge-adguardhome", "AdGuardHome", AdGuardHome);
};

class AdGuardHome implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private readonly manufacturer: string;
  private readonly model: string;
  private readonly serial: string;

  private username: string;
  private password: string;
  private host: string;
  private port: string;

  private readonly gotInstance: Got;
  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;

    this.manufacturer = config["manufacturer"] || "Raspberry Pi";
    this.model = config["model"] || "AdGuard Home";
    this.serial = config["serial-number"] || "123-456-789";

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
            .then((body: any) => {
              const enabled = body.protection_enabled === true;
              this.log.info(
                "Current state of the switch was returned: " +
                  (enabled ? "ON" : "OFF")
              );
              callback(undefined, enabled);
            })
            .catch((error) => {
              this.log.error(error.response.body);
              callback(error);
            });
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
              const enabled = res.statusCode === 200;
              this.log.info(
                "Switch state was set to: " + (enabled ? "ON" : "OFF")
              );
              callback(null, enabled);
            })
            .catch((error) => {
              this.log.error(error.response.body);
              callback(error);
            });
        }
      );

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

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
