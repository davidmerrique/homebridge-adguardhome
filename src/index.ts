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
import fs from "fs";

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
  private readonly username: string;
  private readonly password: string;
  private readonly host: string;
  private readonly port: string;
  private readonly https: boolean;
  private readonly interval: number;
  private readonly stateLogging: boolean;
  private readonly type: string;
  private readonly debug: boolean;
  private readonly autoOnTimer: number[];
  private activeAutoOnTimer?: string;
  private hideNonTimer: boolean;

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

  private readonly storageName: string;

  private readonly gotInstance: Got;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
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
    this.hideNonTimer = config["hideNonTimer"] || false;

    // Current active timer identifier
    this.activeAutoOnTimer = undefined;

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

    // Get storage path
    this.storageName = api.user.storagePath() + "/adguardhome_timer.config";

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

    // Create main accessory services if needed
    this.accessoryServices = [];
    if (!this.hideNonTimer && !this.haveTimers()) {
      if (this.isLock()) {
        this.accessoryServices.push(
          new hap.Service.LockMechanism(this.name, "main_lock")
        );
      } else {
        this.accessoryServices.push(
          new hap.Service.Switch(this.name, "main_switch")
        );
      }
    }

    // Create timer accessories
    this.autoOnTimer.forEach((timer, index) => {
      if (timer > 0) {
        // eslint-disable-next-line prettier/prettier
        const subtype = "timer_" + (this.isLock() ? "lock_" : "switch_") + index + ":" + timer;

        let name = this.timerName(index);
        if (this.hideNonTimer) {
          name = this.name;
          this.hideNonTimer = false;
        }

        const service = this.isLock()
          ? new hap.Service.LockMechanism(name, subtype)
          : new hap.Service.Switch(name, subtype);
        service.setCharacteristic(hap.Characteristic.ConfiguredName, name);

        this.accessoryServices.push(service);
      }
    });

    // Assign default events to all accesories
    this.accessoryServices.forEach((accessoryService) => {
      this.assignDefaultEvents(accessoryService);
    });

    // Main loop
    this.loopStates();

    // Check if there is previous unfinished timer, and run it again
    this.checkUnfinishedTimer();

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    this.log.info("👏 Finished initializing!");
  }

  getServices(): Service[] {
    return this.accessoryServices.concat(this.informationService);
  }

  private createTimerStorage(): Promise<void> {
    return new Promise((resolve) => {
      fs.access(this.storageName, fs.constants.F_OK, (err) => {
        if (err) this.writeTimerStorage(`0`);
        resolve();
      });
    });
  }

  private writeTimerStorage(timer: string) {
    fs.writeFile(this.storageName, timer, "utf8", (err) => {
      if (err) this.log.info("Error writing to the file:", err);
    });
  }

  private readTimerStorage(): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(this.storageName, "utf8", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  private checkUnfinishedTimer() {
    this.createTimerStorage().then(() => {
      this.readTimerStorage().then((timer) => {
        const timerNumber = Number(timer);

        if (Number.isNaN(timerNumber)) {
          this.writeTimerStorage("0");
          return;
        }
        if (timerNumber === 0) return;

        const now = new Date().getTime();
        const delta = (timerNumber - now) / (1000 * 60);
        // eslint-disable-next-line prettier/prettier
        const finalDelta = delta < 0 ? 0 : delta > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : delta;

        this.runTimer(finalDelta, true);
      });
    });
  }

  private haveTimers() {
    this.autoOnTimer.forEach((timer) => {
      if (timer > 0) return true;
    });
    return false;
  }

  private runTimer(timer: number, fromCheckUnfinishedTimer = false) {
    timer = Math.round(timer * 100) / 100;

    // eslint-disable-next-line prettier/prettier
    this.log.info(`⏲️ - ${fromCheckUnfinishedTimer ? `Unfinished timer, ` : ``}AdGuard Home will be locked in ${timer} minute${timer > 1 ? "s" : ""}`);

    const offTimer = new Date().getTime() + timer * 1000 * 60;
    this.writeTimerStorage(`${offTimer}`);

    this.autoOnHandler = setTimeout(() => {
      // eslint-disable-next-line prettier/prettier
      this.log.info(`⏲️ - The ${timer} minute${timer > 1 ? "s" : ""} timer finish`);
      this.setAdGuardHome(this.onState);
      this.autoOnHandler = undefined;
      this.activeAutoOnTimer = undefined;
      this.writeTimerStorage("0");
    }, timer * 1000 * 60);
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

  private isActiveAccesory(accessory) {
    return (
      accessory.subtype?.includes("main_") ||
      (this.activeAutoOnTimer != undefined &&
        accessory.subtype == this.activeAutoOnTimer)
    );
  }

  private updateStates() {
    if (this.isJammed()) {
      // If jammed, output jammed status
      this.accessoryServices.forEach((accessory) => {
        accessory
          .getCharacteristic(
            this.isLock()
              ? hap.Characteristic.LockCurrentState
              : hap.Characteristic.On
          )
          .updateValue(this.jammedState);
      });
    } else if (this.currentState !== this.targetState) {
      // Update to target state
      // eslint-disable-next-line prettier/prettier
      this.currentState =
        this.targetState === this.onState ? this.onState : this.offState;

      this.accessoryServices.forEach((accessory) => {
        const isActiveAccesory = this.isActiveAccesory(accessory);
        // eslint-disable-next-line prettier/prettier
        const currentState = isActiveAccesory ? this.currentState : this.onState;
        const targetState = isActiveAccesory ? this.targetState : this.onState;

        if (this.isLock()) {
          accessory
            .getCharacteristic(hap.Characteristic.LockCurrentState)
            .updateValue(currentState);
          accessory
            .getCharacteristic(hap.Characteristic.LockTargetState)
            .updateValue(targetState);
        } else {
          accessory
            .getCharacteristic(hap.Characteristic.On)
            .updateValue(currentState);
        }

        if (isActiveAccesory)
          // eslint-disable-next-line prettier/prettier
          this.log(accessory.displayName, `- Current status: ${currentState ? "🟢 Locked" : "🔴 Unlocked"}`);

        if (this.stateLogging)
          // eslint-disable-next-line prettier/prettier
          this.log.info(accessory.displayName, " - Updating :", currentState ? "🟢 Locked" : "🔴 Unlocked");
      });
    }
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
      // Get accessories value
      .on(
        CharacteristicEventTypes.GET,
        (callback: CharacteristicGetCallback) => {
          // Return correct value only if it's main accessory or current timer accessory
          callback(
            null,
            this.isActiveAccesory(service) ? this.targetState : this.onState
          );
        }
      )
      // Set accessories value
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

            this.activeAutoOnTimer = service.subtype;

            // Do the timer
            if (value === this.offState) this.runTimer(timer);
          }

          callback(null);
        }
      );

    if (this.isLock()) {
      service
        .getCharacteristic(hap.Characteristic.LockCurrentState)
        // Get accessories value for lock accessories
        .on(
          CharacteristicEventTypes.GET,
          (callback: CharacteristicGetCallback) => {
            // Limit API call one in a time
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
                      .updateValue(
                        this.isActiveAccesory(service)
                          ? this.currentState
                          : this.onState
                      );
                  });
                });
            }

            // Return correct value only if it's main accessory or current timer accessory
            callback(
              null,
              this.isActiveAccesory(service) ? this.currentState : this.onState
            );
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
      } else this.log.info("🤷 AdGuard Home is offline or unreachable");

      this.currentState = this.jammedState;
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
        this.log.info(`Setting to: ${status === this.onState ? "🟢 Locked" : "🔴 Unlocked"}`);

        this.updateStates();
      })
      .catch((error) => this.accessoryIsOffline(error));
  }
}
