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
  private stateLogging: boolean;
  private type: string;
  private debug: boolean;
  private autoOnTimerName: string;
  private autoOnTimer: number;
  private autoOnHandler: NodeJS.Timeout;
  // Cache for accessory status
  private currentState: CharacteristicValue;
  private targetState: CharacteristicValue;
  // Accesory States
  private onState: CharacteristicValue;
  private offState: CharacteristicValue;
  private unknownState: CharacteristicValue;
  private jammedState: CharacteristicValue;

  private readonly gotInstance: Got;
  private readonly accessoryService: Service;
  private readonly accessoryServiceTimer: Service;
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
    this.stateLogging = config["stateLogging"] || false;
    this.type = config["type"] || "SWITCH";
    this.debug = config["debug"] || false;
    this.autoOnTimer = config["autoOnTimer"] || 0;
    this.autoOnTimerName =
      config["autoOnTimerName"] || "${this.name} ${this.autoOnTimer}s Timer";
    this.autoOnHandler = setTimeout(() => {
      // do nothing
    }, 0);

    // Setup default states values
    this.onState = true;
    this.offState = false;
    this.unknownState = this.offState;
    this.jammedState = this.offState;
    this.currentState = this.offState;
    this.targetState = this.offState;

    const Authorization = `Basic ${Buffer.from(
      `${this.username}:${this.password}`
    ).toString("base64")}`;

    this.gotInstance = got.extend({
      // eslint-disable-next-line prettier/prettier
      prefixUrl: `http${this.https ? "s" : ""}://${this.host}:${this.port}/control`,
      responseType: "json",
      headers: {
        Authorization,
      },
      https: {
        rejectUnauthorized: false,
      },
    });

    // Main accessory
    if (this.isLock()) {
      // Accesory is a lock
      this.onState = hap.Characteristic.LockCurrentState.SECURED;
      this.offState = hap.Characteristic.LockCurrentState.UNSECURED;
      this.unknownState = hap.Characteristic.LockCurrentState.UNKNOWN;
      this.jammedState = hap.Characteristic.LockCurrentState.JAMMED;

      this.currentState = this.offState;
      this.targetState = this.offState;

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
                if (this.stateLogging)
                  this.log.info(
                    `Current state: ${enabled ? "🔒 Enable" : "🔓 Disable"}`
                  );
                this.currentState = enabled ? this.onState : this.offState;
              })
              .catch((error) => this.accessoryIsOffline(error))
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
            this.setAdGuardHome(value);
            callback(null);
          }
        );
    } else {
      // Accesory is a switch
      this.accessoryService = new hap.Service.Switch(this.name);
      this.accessoryService
        .getCharacteristic(hap.Characteristic.On)
        .on(
          CharacteristicEventTypes.GET,
          (callback: CharacteristicGetCallback) => {
            callback(null, this.targetState);
          }
        )
        .on(
          CharacteristicEventTypes.SET,
          (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            this.setAdGuardHome(value);
            callback(null);
          }
        );
    }

    // Timer accesory
    this.accessoryServiceTimer = new hap.Service.Switch(this.autoOnTimerName);
    this.accessoryServiceTimer
      .getCharacteristic(hap.Characteristic.On)
      .on(
        CharacteristicEventTypes.GET,
        (callback: CharacteristicGetCallback) => {
          callback(null, this.targetState);
        }
      )
      .on(
        CharacteristicEventTypes.SET,
        (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.setAdGuardHome(value);
          clearTimeout(this.autoOnHandler);

          if (value === false) {
            this.log.info(
              `⏲️ - Will turn on AdGuard Home in ${this.autoOnTimer} minute(s)`
            );

            // Do the timer
            this.autoOnHandler = setTimeout(() => {
              this.setAdGuardHome(this.onState);
              this.updateState();
            }, this.autoOnTimer * 1000 * 60);
          } else {
            this.log.info(`⏲️ - Clearing timer`);
          }

          callback(null);
        }
      );

    // The loop
    setInterval(() => {
      this.updateState();
    }, this.interval);

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    this.log.info("👏 Finished initializing!");
  }

  getServices(): Service[] {
    if (this.autoOnTimer > 0) {
      return [
        this.informationService,
        this.accessoryService,
        this.accessoryServiceTimer,
      ];
    } else {
      return [this.informationService, this.accessoryService];
    }
  }

  private updateState() {
    this.gotInstance("status")
      .json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((body: any) => {
        const enabled = body.protection_enabled === true;
        this.targetState = enabled ? this.onState : this.offState;
        if (this.isJammed()) {
          this.currentState = this.isLock()
            ? this.unknownState
            : this.jammedState;
          if (this.stateLogging) this.log.info("Accessory is jammed");
        }
      })
      .catch((error) => this.accessoryIsOffline(error))
      .then(() => {
        if (this.isJammed()) {
          this.accessoryService
            .getCharacteristic(
              this.isLock()
                ? hap.Characteristic.LockCurrentState
                : hap.Characteristic.On
            )
            .updateValue(this.currentState);

          if (this.autoOnTimer > 0) {
            this.accessoryServiceTimer
              .getCharacteristic(hap.Characteristic.On)
              .updateValue(false);
          }
        } else if (this.currentState != this.targetState) {
          this.log(`Updating to: ${this.targetState ? "🟡 ON" : "⚪️ OFF"}`);
          this.currentState =
            this.targetState === this.onState ? this.onState : this.offState;
          if (this.isLock()) {
            this.accessoryService
              .getCharacteristic(hap.Characteristic.LockCurrentState)
              .updateValue(this.currentState);
            this.accessoryService
              .getCharacteristic(hap.Characteristic.LockTargetState)
              .updateValue(this.targetState);
          } else {
            this.accessoryService
              .getCharacteristic(hap.Characteristic.On)
              .updateValue(this.currentState);
          }

          if (this.autoOnTimer > 0) {
            this.accessoryServiceTimer
              .getCharacteristic(hap.Characteristic.On)
              .updateValue(this.currentState === this.onState ? true : false);
          }
        }
      });

    if (this.stateLogging)
      this.log.info(
        // eslint-disable-next-line prettier/prettier
        `Current state: ${this.currentState ? "🔒 Enable" : "🔓 Disable"}`
      );
  }

  private isLock(): boolean {
    return this.type == "LOCK" ? true : false;
  }

  private isJammed(): boolean {
    if (this.type == "LOCK")
      return this.currentState == hap.Characteristic.LockCurrentState.JAMMED;
    else return this.currentState == "JAMMED";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private accessoryIsOffline(error: any) {
    if (!this.isJammed()) {
      if (this.debug) {
        if (error.response) this.log.error(error.response.body);
        else this.log.error(error);
      } else this.log.info("🤷 Accessory is offline or unreachable");

      if (this.type == "LOCK")
        this.currentState = hap.Characteristic.LockCurrentState.JAMMED;
      else this.currentState = "JAMMED";
    }
  }

  private setAdGuardHome(status: CharacteristicValue) {
    this.gotInstance
      .post("dns_config", {
        json: {
          protection_enabled: !!status,
        },
      })
      .then((res) => {
        const enabled = res.statusCode === 200;
        this.log.info(`Set to: ${enabled ? "🔒 Enable" : "🔓 Disable"}`);
        this.targetState = enabled ? this.onState : this.offState;
      })
      .catch((error) => this.accessoryIsOffline(error));
  }
}
