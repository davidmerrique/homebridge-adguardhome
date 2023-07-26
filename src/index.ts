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
  private autoOnTimer: number[];
  private autoOnHandler?: NodeJS.Timeout;
  // Cache for accessory status
  private currentState: CharacteristicValue;
  private targetState: CharacteristicValue;
  // Accesory States
  private onState: CharacteristicValue;
  private offState: CharacteristicValue;
  private unknownState: CharacteristicValue;
  private jammedState: CharacteristicValue;
  // Services
  private accessoryServices: Service[];
  private onAPICall: boolean;

  private readonly gotInstance: Got;
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
    this.type = this.type.toUpperCase();
    this.debug = config["debug"] || false;
    this.autoOnTimer = config["autoOnTimer"] || [];

    // Setup default states values
    this.onState = this.isLock()
      ? hap.Characteristic.LockCurrentState.SECURED
      : true;
    this.offState = this.isLock()
      ? hap.Characteristic.LockCurrentState.UNSECURED
      : false;
    this.unknownState = this.isLock()
      ? hap.Characteristic.LockCurrentState.UNKNOWN
      : this.offState;
    this.jammedState = this.isLock()
      ? hap.Characteristic.LockCurrentState.JAMMED
      : this.offState;
    this.currentState = this.offState;
    this.targetState = this.offState;

    // Authorization to API
    const Authorization = `Basic ${Buffer.from(
      `${this.username}:${this.password}`
    ).toString("base64")}`;
    this.onAPICall = false;

    // Get the API handle
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

    // Create main accessory services
    if (this.isLock()) {
      this.accessoryServices = [
        new hap.Service.LockMechanism(this.name, "main_lock"),
      ];
    } else {
      this.accessoryServices = [
        new hap.Service.Switch(this.name, "main_switch"),
      ];
    }

    // Create timer accessories
    this.autoOnTimer.forEach((timer, index) => {
      if (timer > 0) {
        const name = this.timerName(index);
        const subtype =
          "timer_" +
          (this.isLock() ? "lock_" : "switch_") +
          index +
          ":" +
          timer;
        const service = this.isLock()
          ? new hap.Service.LockMechanism(name, subtype)
          : new hap.Service.Switch(name, subtype);
        this.accessoryServices.push(service);
      }
    });

    // Assign default events to all accesories
    this.accessoryServices.forEach((accessoryService) => {
      this.assignDefaultEvents(accessoryService);
    });

    // Main loop
    this.loopStates();

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    this.log.info("👏 Finished initializing!");
  }

  getServices(): Service[] {
    return this.accessoryServices.concat(this.informationService);
  }

  private loopStates() {
    setInterval(() => {
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
            if (this.stateLogging) this.log.info("😢 - Accessory is jammed");
          }
        })
        .catch((error) => this.accessoryIsOffline(error))
        .then(() => {
          this.updateStates();
        });
    }, this.interval);
  }

  private updateStates() {
    this.accessoryServices.forEach((accessory) => {
      if (this.isJammed()) {
        accessory
          .getCharacteristic(
            this.isLock()
              ? hap.Characteristic.LockCurrentState
              : hap.Characteristic.On
          )
          .updateValue(this.currentState);
      } else if (this.currentState !== this.targetState) {
        // eslint-disable-next-line prettier/prettier
        this.currentState =
          this.targetState === this.onState ? this.onState : this.offState;

        if (this.isLock()) {
          accessory
            .getCharacteristic(hap.Characteristic.LockCurrentState)
            .updateValue(this.currentState);
          accessory
            .getCharacteristic(hap.Characteristic.LockTargetState)
            .updateValue(this.targetState);
        } else {
          accessory
            .getCharacteristic(hap.Characteristic.On)
            .updateValue(this.currentState);
        }

        // eslint-disable-next-line prettier/prettier
        this.log(`Current status: ${this.currentState ? "🟢 Locked" : "🔴 Unlocked"}`);
      }
      if (this.stateLogging)
        // eslint-disable-next-line prettier/prettier
        this.log.info("Updating", accessory.displayName, ":", this.currentState ? "🟢 Locked" : "🔴 Unlocked");
    });
  }

  private timerName(index: number) {
    // eslint-disable-next-line prettier/prettier
    return `${this.name} ${this.autoOnTimer[index]} ${this.autoOnTimer[index] > 1 ? "Minutes" : "Minute"} Timer`;
  }

  private isLock(): boolean {
    return this.type == "LOCK" ? true : false;
  }

  private isJammed(): boolean {
    if (this.type == "LOCK")
      return this.currentState == hap.Characteristic.LockCurrentState.JAMMED;
    else return this.currentState == "JAMMED";
  }

  private assignDefaultEvents(service: Service) {
    service
      .getCharacteristic(
        this.isLock()
          ? hap.Characteristic.LockTargetState
          : hap.Characteristic.On
      )
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

          if (this.autoOnHandler != undefined) {
            this.log.info(`⏲️ - Clearing previous timer`);
            clearTimeout(this.autoOnHandler);
          }

          if (service.subtype?.includes("timer")) {
            const timer = Number(service.subtype.split(":")[1]);

            if (value === this.offState) {
              // eslint-disable-next-line prettier/prettier
              this.log.info(`⏲️ - AdGuard Home will be locked in ${timer} minute${timer > 1 ? "s" : ""}`);

              // Do the timer
              this.autoOnHandler = setTimeout(() => {
                // eslint-disable-next-line prettier/prettier
                this.log.info(`⏲️ - The ${timer} minute${timer > 1 ? "s" : ""} timer finish`);
                this.setAdGuardHome(this.onState);
                this.autoOnHandler = undefined;
              }, timer * 1000 * 60);
            }
          }

          callback(null);
        }
      );

    if (this.isLock()) {
      service
        .getCharacteristic(hap.Characteristic.LockCurrentState)
        .on(
          CharacteristicEventTypes.GET,
          (callback: CharacteristicGetCallback) => {
            // Call API one in a time
            if (!this.onAPICall) {
              this.onAPICall = true;
              this.gotInstance("status")
                .json()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((body: any) => {
                  const enabled = body.protection_enabled === true;
                  if (this.stateLogging)
                    // eslint-disable-next-line prettier/prettier
                    this.log.info(`Current server state: ${enabled ? "🟢 Locked" : "🔴 Unlocked"}`);
                  this.currentState = enabled ? this.onState : this.offState;
                })
                .catch((error) => this.accessoryIsOffline(error))
                .then(() => {
                  this.onAPICall = false;
                  this.accessoryServices.forEach((service) => {
                    service
                      .getCharacteristic(hap.Characteristic.LockCurrentState)
                      .updateValue(this.currentState);
                  });
                });
            }

            callback(null, this.currentState);
          }
        );
    }
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
        if (this.stateLogging && enabled) this.log.info("Command success");

        this.targetState =
          status === this.onState ? this.onState : this.offState;
        // eslint-disable-next-line prettier/prettier
        this.log.info(`Seting to: ${status === this.onState ? "🟢 Locked" : "🔴 Unlocked"}`);

        this.updateStates();
      })
      .catch((error) => this.accessoryIsOffline(error));
  }
}
