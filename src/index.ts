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
  private interval: number;
  private debug: boolean;
  // Cache for accessory status
  private currentState: CharacteristicValue;
  private targetState: CharacteristicValue;

  private readonly gotInstance: Got;
  private readonly accessoryService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig) {
    this.log = log;
    this.name = config.name;

    this.manufacturer = config["manufacturer"] || "Homebridge";
    this.model = config["model"] || "AdGuard Home";
    this.serial = config["serial-number"] || "123-456-789";

    this.username = config["username"];
    this.password = config["password"];
    this.host = config["host"] || "localhost";
    this.port = config["port"] || 80;
    this.https = !!config["https"];
    this.interval = config["interval"] || 5000;
    this.debug = config["debug"] || false;
    this.currentState = hap.Characteristic.LockCurrentState.UNSECURED;
    this.targetState = hap.Characteristic.LockTargetState.UNSECURED;

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

    this.accessoryService = new hap.Service.LockMechanism(this.name);

    this.accessoryService
      .getCharacteristic(hap.Characteristic.LockCurrentState)
      .on(
        CharacteristicEventTypes.GET,
        (callback: CharacteristicGetCallback) => {
          this.gotInstance("status")
            .json()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((body: any) => {
              const enabled = body.protection_enabled === true;
              if (config["stateLogging"])
                this.log.info(`Current state: ${enabled ? "ON" : "OFF"}`);
              this.currentState = enabled
                ? hap.Characteristic.LockCurrentState.SECURED
                : hap.Characteristic.LockCurrentState.UNSECURED;
            })
            .catch((error) => {
              if (
                this.currentState != hap.Characteristic.LockCurrentState.JAMMED
              ) {
                if (this.debug) {
                  if (error.response) this.log.error(error.response.body);
                  else this.log.error(error);
                } else this.log.info("Accessory is offline");
                this.currentState = hap.Characteristic.LockCurrentState.JAMMED;
              }
            })
            .then(() => {
              this.accessoryService
                .getCharacteristic(hap.Characteristic.LockCurrentState)
                .updateValue(this.currentState);
            });
          callback(null, this.currentState);
        }
      );

    this.accessoryService
      .getCharacteristic(hap.Characteristic.LockTargetState)
      .on(
        CharacteristicEventTypes.GET,
        (callback: CharacteristicGetCallback) => {
          callback(null, this.targetState);
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
              this.log.info(`Set to: ${enabled ? "ON" : "OFF"}`);
              this.targetState = enabled
                ? hap.Characteristic.LockTargetState.SECURED
                : hap.Characteristic.LockTargetState.UNSECURED;
            })
            .catch((error) => {
              if (
                this.currentState != hap.Characteristic.LockCurrentState.JAMMED
              ) {
                if (this.debug) {
                  if (error.response) this.log.error(error.response.body);
                  else this.log.error(error);
                } else this.log.info("Accessory is offline");
                this.currentState = hap.Characteristic.LockCurrentState.JAMMED;
              }
            });
          callback(null);
        }
      );

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    setInterval(() => {
      this.gotInstance("status")
        .json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((body: any) => {
          const enabled = body.protection_enabled === true;
          this.targetState = enabled
            ? hap.Characteristic.LockTargetState.SECURED
            : hap.Characteristic.LockTargetState.UNSECURED;
          if (this.currentState == hap.Characteristic.LockCurrentState.JAMMED) {
            this.currentState = hap.Characteristic.LockCurrentState.UNKNOWN;
            this.log.info("Accessory is online");
          }
        })
        .catch(() => {
          if (this.currentState != hap.Characteristic.LockCurrentState.JAMMED) {
            this.log.info("Accessory is offline");
            this.currentState = hap.Characteristic.LockCurrentState.JAMMED;
          }
        })
        .then(() => {
          if (this.currentState == hap.Characteristic.LockCurrentState.JAMMED) {
            this.accessoryService
              .getCharacteristic(hap.Characteristic.LockCurrentState)
              .updateValue(this.currentState);
          } else if (this.currentState != this.targetState) {
            this.log(`Setting to ${this.targetState}`);
            this.currentState =
              this.targetState == hap.Characteristic.LockTargetState.SECURED
                ? hap.Characteristic.LockCurrentState.SECURED
                : hap.Characteristic.LockCurrentState.UNSECURED;
            this.accessoryService
              .getCharacteristic(hap.Characteristic.LockTargetState)
              .updateValue(this.targetState);
            this.accessoryService
              .getCharacteristic(hap.Characteristic.LockCurrentState)
              .updateValue(this.currentState);
          }
        });
    }, this.interval);

    this.log.info("Finished initializing!");
  }

  getServices(): Service[] {
    return [this.informationService, this.accessoryService];
  }
}
