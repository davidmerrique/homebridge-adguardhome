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

export = (api: API): void => {
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
  private https: boolean;

  private readonly gotInstance: Got;
  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig) {
    this.log = log;
    this.name = config.name;

    this.manufacturer = config["manufacturer"] || "Raspberry Pi";
    this.model = config["model"] || "AdGuard Home";
    this.serial = config["serial-number"] || "123-456-789";

    this.username = config["username"];
    this.password = config["password"];
    this.host = config["host"] || "localhost";
    this.port = config["port"] || 80;
    this.https = !!config["https"];

    const Authorization = `Basic ${Buffer.from(
      `${this.username}:${this.password}`
    ).toString("base64")}`;

    this.gotInstance = got.extend({
      prefixUrl: `http${this.https ? "s" : ""}://${this.host}:${
        this.port
      }/control`,
      responseType: "json",
      headers: {
        Authorization,
      },
      https: {
        rejectUnauthorized: false,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((body: any) => {
              const enabled = body.protection_enabled === true;
              if (config["stateLogging"]) {
                this.log.info(
                  `Current state of the switch was returned: ${
                    enabled ? "ON" : "OFF"
                  }`
                );
              }
              callback(undefined, enabled);
            })
            .catch((error) => {
              if (error.response) this.log.error(error.response.body);
              else this.log.error(error);
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
                `Switch state was set to: ${enabled ? "ON" : "OFF"}`
              );
              callback(null, enabled);
            })
            .catch((error) => {
              if (error.response) this.log.error(error.response.body);
              else this.log.error(error);
              callback(error);
            });
        }
      );

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    this.log.info("Switch finished initializing!");
  }

  getServices(): Service[] {
    return [this.informationService, this.switchService];
  }
}
