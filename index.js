import got from "got";
import fs from "fs";
import { crypt } from "unixpass";
import { createHash } from "crypto";
let hap;
class AdGuardHome {
  constructor(log, config, api) {
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
    this.url = `http${this.https ? "s" : ""}://${this.host}:${this.port}`;
    this.rpc = `${this.url}/rpc`;
    this.isGlinet = config["isGlinet"] || false;
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
    this.onState = this.isLock() ? hap.Characteristic.LockCurrentState.SECURED : true;
    this.offState = this.isLock() ? hap.Characteristic.LockCurrentState.UNSECURED : false;
    this.unknownState = this.isLock() ? hap.Characteristic.LockCurrentState.UNKNOWN : this.offState;
    this.jammedState = this.isLock() ? hap.Characteristic.LockCurrentState.JAMMED : this.offState;
    this.currentState = this.offState;
    this.targetState = this.offState;
    // Get storage path
    this.storageName = api.user.storagePath() + "/adguardhome-timer.config";
    // Set initial state of onAPIcall
    this.onAPICall = false;
    // Get API handle for regular AdGuard Home server
    if (!this.isGlinet) {
      // Authorization to API
      const Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
      // Get the API default handler
      this.gotInstance = got.extend({
        prefixUrl: `${this.url}/control`,
        responseType: "json",
        headers: {
          Authorization,
        },
        https: {
          rejectUnauthorized: false,
        },
      });
    }
    // Create main accessory services if needed
    this.accessoryServices = [];
    if (!this.hideNonTimer && !this.haveTimers()) {
      if (this.isLock()) this.accessoryServices.push(new hap.Service.LockMechanism(this.name, "main_lock"));
      else this.accessoryServices.push(new hap.Service.Switch(this.name, "main_switch"));
    }
    // Create timer accessories
    this.autoOnTimer.forEach((timer, index) => {
      if (timer > 0) {
        const subtype = "timer_" + (this.isLock() ? "lock_" : "switch_") + index + ":" + timer;
        let name = this.timerName(index);
        if (this.hideNonTimer) {
          name = this.name;
          this.hideNonTimer = false;
        }
        const service = this.isLock() ? new hap.Service.LockMechanism(name, subtype) : new hap.Service.Switch(name, subtype);
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
    this.log.info("👏 Finish initializing!");
  }
  getServices() {
    return this.accessoryServices.concat(this.informationService);
  }
  // Assign default events to timer accessories
  assignDefaultEvents(service) {
    service
      .getCharacteristic(this.isLock() ? hap.Characteristic.LockTargetState : hap.Characteristic.On)
      // Get accessories value
      .on("get" /* CharacteristicEventTypes.GET */, (callback) => {
        // Return correct value only if it's main accessory or current timer accessory
        callback(null, this.isActiveAccessory(service) ? this.targetState : this.onState);
      })
      // Set accessories value
      .on("set" /* CharacteristicEventTypes.SET */, (value, callback) => {
        var _a;
        this.setAdGuardHome(value);
        if (this.autoOnHandler != undefined) {
          this.log.info(`⏲️ - Clearing previous timer`);
          clearTimeout(this.autoOnHandler);
        }
        if ((_a = service.subtype) === null || _a === void 0 ? void 0 : _a.includes("timer")) {
          const timer = Number(service.subtype.split(":")[1]);
          this.activeAutoOnTimer = service.subtype;
          // Do the timer
          if (value === this.offState)
            this.runTimer(timer);
        }
        callback(null);
      });
    if (this.isLock()) {
      service
        .getCharacteristic(hap.Characteristic.LockCurrentState)
        // Get accessories value for lock accessories
        .on("get" /* CharacteristicEventTypes.GET */, (callback) => {
          // Limit API call one in a time
          if (!this.onAPICall) {
            this.onAPICall = true;
            if (this.isGlinet) {
              // Glinet stuff
              const run = async () => {
                const status = await this.getGlinetState();
                if (status != undefined) this.currentState = status ? this.onState : this.offState;
                else this.currentState = this.jammedState;
                this.onAPICall = false;
                this.accessoryServices.forEach((service) => {
                  service
                    .getCharacteristic(hap.Characteristic.LockCurrentState)
                    .updateValue(this.isActiveAccessory(service) ? this.currentState : this.onState);
                });
              };
              run();
            }
            else if (this.gotInstance) {
              this.gotInstance("status")
                .json()
                .then((body) => {
                  const enabled = body.protection_enabled === true;
                  if (this.stateLogging) this.log.info(`Current AdGuard Home state: ${enabled ? "🔒 Locked" : "🔓 Unlocked"}`);
                  this.currentState = enabled ? this.onState : this.offState;
                })
                .catch((error) => this.accessoryIsOffline(error))
                .then(() => {
                  this.onAPICall = false;
                  this.accessoryServices.forEach((service) => {
                    service
                      .getCharacteristic(hap.Characteristic.LockCurrentState)
                      .updateValue(this.isActiveAccessory(service) ? this.currentState : this.onState);
                  });
                });
            }
          }
          // Return correct value only if it's main accessory or current timer accessory
          callback(null, this.isActiveAccessory(service) ? this.currentState : this.onState);
        });
    }
  }
  // Timer
  // Create timer storage
  createTimerStorage() {
    return new Promise((resolve) => {
      fs.access(this.storageName, fs.constants.F_OK, (err) => {
        if (err) this.writeTimerStorage(`0`);
        resolve();
      });
    });
  }
  // Write timer to file, usually named as: adguardhome_timer.config
  writeTimerStorage(timer) {
    fs.writeFile(this.storageName, timer, "utf8", (err) => {
      if (err) this.log.info("Error writing to the file:", err);
    });
  }
  // Read timer config from file.
  readTimerStorage() {
    return new Promise((resolve, reject) => {
      fs.readFile(this.storageName, "utf8", (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }
  // Check if theres unfinished timer, usefull when server got restarted when a timer is running
  checkUnfinishedTimer() {
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
        const finalDelta = delta < 0 ? 0 : delta > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : delta;
        this.runTimer(finalDelta, true);
      });
    });
  }
  // Check if have timer
  haveTimers() {
    this.autoOnTimer.forEach((timer) => {
      if (timer > 0) return true;
    });
    return false;
  }
  // Running timers
  runTimer(timer, fromCheckUnfinishedTimer = false) {
    timer = Math.round(timer * 100) / 100;

    this.log.info(`⏲️ - ${fromCheckUnfinishedTimer ? `Unfinished timer, ` : ``}AdGuardHome will be locked in ${timer} minute${timer > 1 ? "s" : ""}`);
    const offTimer = new Date().getTime() + timer * 1000 * 60;
    this.writeTimerStorage(`${offTimer}`);
    this.autoOnHandler = setTimeout(() => {
      this.log.info(`⏲️ - The ${timer} minute${timer > 1 ? "s" : ""} timer finish`);
      this.setAdGuardHome(this.onState);
      this.autoOnHandler = undefined;
      this.activeAutoOnTimer = undefined;
      this.writeTimerStorage("0");
    }, timer * 1000 * 60);
  }
  // Looping state
  loopStates() {
    const run = async () => {
      if (this.isGlinet) {
        const status = await this.getGlinetState();
        if (status !== undefined) this.targetState = status ? this.onState : this.offState;
        else {
          if (this.isJammed()) {
            this.currentState = this.isLock() ? this.unknownState : this.jammedState;
            if (this.stateLogging) this.log.info("😢 - Accessory is jammed");
          }
          this.accessoryIsOffline("Can't reach GliNet");
        }
        this.updateStates();
      }
      else if (this.gotInstance) {
        this.gotInstance("status")
          .json()
          .then((body) => {
            const enabled = body.protection_enabled === true;
            this.targetState = enabled ? this.onState : this.offState;
            if (this.isJammed()) {
              this.currentState = this.isLock() ? this.unknownState : this.jammedState;
              if (this.stateLogging) this.log.info("😢 - Accessory is jammed");
            }
          })
          .catch((error) => this.accessoryIsOffline(error))
          .then(() => {
            this.updateStates();
          });
      }
    };
    setInterval(run, this.interval);
  }
  // Check is active accessories
  isActiveAccessory(accessory) {
    var _a;
    return (((_a = accessory.subtype) === null || _a === void 0 ? void 0 : _a.includes("main_")) || (this.activeAutoOnTimer != undefined && accessory.subtype == this.activeAutoOnTimer));
  }
  // Name the timer accessories
  timerName(index) {
    return `${this.name} ${this.autoOnTimer[index]} ${this.autoOnTimer[index] > 1 ? "Minutes" : "Minute"} Timer`;
  }
  // Update Homekit status
  updateStates() {
    if (this.isJammed()) {
      // If jammed, output jammed status
      this.accessoryServices.forEach((accessory) => {
        accessory
          .getCharacteristic(this.isLock() ? hap.Characteristic.LockCurrentState : hap.Characteristic.On)
          .updateValue(this.jammedState);
      });
    }
    else if (this.currentState !== this.targetState) {
      // Update to target state

      this.currentState = this.targetState === this.onState ? this.onState : this.offState;
      this.accessoryServices.forEach((accessory) => {
        const isActiveAccessory = this.isActiveAccessory(accessory);
        const currentState = isActiveAccessory ? this.currentState : this.onState;
        const targetState = isActiveAccessory ? this.targetState : this.onState;
        if (this.isLock()) {
          accessory
            .getCharacteristic(hap.Characteristic.LockCurrentState)
            .updateValue(currentState);
          accessory
            .getCharacteristic(hap.Characteristic.LockTargetState)
            .updateValue(targetState);
        }
        else {
          accessory
            .getCharacteristic(hap.Characteristic.On)
            .updateValue(currentState);
        }
        if (isActiveAccessory || this.stateLogging)
          this.log(`${accessory.displayName} - Current status: ${currentState ? "🔒 Locked" : "🔓 Unlocked"}`);
      });
    }
  }
  // Check if state is locked
  isLock() {
    return this.type == "LOCK" ? true : false;
  }
  // Check if state is jammed
  isJammed() {
    if (this.type == "LOCK") return this.currentState == hap.Characteristic.LockCurrentState.JAMMED;
    else return this.currentState == "JAMMED";
  }
  // Make the accesory offlin
  accessoryIsOffline(error) {
    if (!this.isJammed()) {
      if (this.debug) {
        if (error.response) this.log.error(`🐞 - Offline - ${error.response.body}`);
        else this.log.error(`🐞 - Offline - ${error}`);
      }
      else this.log.info("🤷 AdGuard Home is offline or unreachable");
      this.currentState = this.jammedState;
    }
    // Clear Sid since server is offline
    this.glinetSid = undefined;
  }
  // Set AdGuard Home state, on or off
  async setAdGuardHome(status) {
    if (this.isGlinet) {
      // Glinet stuff
      await this.setGlinetState(!!status);
      this.targetState = status === this.onState ? this.onState : this.offState;
      this.updateStates();
    }
    else if (this.gotInstance) {
      this.gotInstance
        .post("dns_config", {
          json: {
            protection_enabled: !!status,
          },
        })
        .then((res) => {
          const enabled = res.statusCode === 200;
          if (this.stateLogging && enabled) this.log.info("Command success");
          this.targetState = status === this.onState ? this.onState : this.offState;
          this.log.info(`Setting to: ${status === this.onState ? "🔒 Locked" : "🔓 Unlocked"}`);
          this.updateStates();
        })
        .catch((error) => this.accessoryIsOffline(error));
    }
  }
  // Glinet API calls
  // GLINET API Error message:
  // -32000 : 'Access denied'
  // -32003 : 'Login fail number over limit'
  // -32602 : 'Invalid params'
  // Get hash value for login
  async getGlinetEncryption() {
    try {
      const response = await got
        .post(this.rpc, {
          json: {
            jsonrpc: "2.0",
            method: "challenge",
            params: {
              username: this.username,
            },
            id: 0,
          },
        })
        .json();
      if (response.result) {
        const result = response.result;
        const alg = result.alg;
        const salt = result.salt;
        const nonce = result.nonce;
        const cipherPassword = crypt(this.password, "$" + alg + "$" + salt + "$");
        const data = `${this.username}:${cipherPassword}:${nonce}`;
        const hash_value = createHash("md5").update(data).digest("hex");
        if (this.debug) this.log.info(`🐞 - New hash - ${hash_value}`);
        return hash_value;
      }
      else
        throw new Error(`No API Result - ${response.error.message}`);
    }
    catch (error) {
      if (this.debug) this.log.info(`🐞 - Encryption - Disconnected - ${error}`);
    }
    return undefined;
  }
  // Get GliNet API SID
  // TODO: Refresh every 5 minutes to generate hash login
  async getGlinetSID() {
    if (this.glinetSid)
      return this.glinetSid;
    try {
      const hash_value = await this.getGlinetEncryption();
      if (hash_value) {
        const response = await got
          .post(this.rpc, {
            json: {
              jsonrpc: "2.0",
              method: "login",
              params: {
                username: "root",
                hash: hash_value,
              },
              id: 0,
            },
          })
          .json();
        if (response.result) {
          this.glinetSid = response.result.sid;
          if (this.debug) this.log.info(`🐞 - New Sid - ${this.glinetSid}`);
        }
        else
          throw new Error(`No API Result: ${response.error.message}`);
      }
      else
        throw new Error(`No hash value`);
    }
    catch (error) {
      if (this.debug) this.log.info(`🐞 - SID - Disconnected - ${error}`);
    }
    // Reset Sid in 4 minutes
    if (this.glinetSidTimeout) clearTimeout(this.glinetSidTimeout);
    this.glinetSidTimeout = setTimeout(() => {
      this.glinetSid = undefined;
    }, 4 * 1000 * 60);
    return this.glinetSid;
  }
  // Get GliNet AdGuard Home state
  async getGlinetState() {
    try {
      const sid = await this.getGlinetSID();
      const response = await got
        .post(this.rpc, {
          json: {
            jsonrpc: "2.0",
            method: "call",
            params: [sid, "adguardhome", "get_config"],
            id: 0,
          },
        })
        .json();
      if (response.result) {
        if (this.debug) this.log.info(`🐞 - AdGuard: ${this.onOff(response.result.enabled)}, DNS: ${this.onOff(response.result.dns_enabled)}`);
        // Return AdGuard Home state
        return response.result.enabled && response.result.dns_enabled;
      }
      else
        throw new Error(`Get - ${response.error.message}`);
    }
    catch (error) {
      if (this.debug) this.log.info(`🐞 - Get - Disconnected - ${error}`);
    }
    // Connection error -> Jammed
    return undefined;
  }
  // Set GliNet AdGuard Home state
  async setGlinetState(state) {
    try {
      const sid = await this.getGlinetSID();
      const response = await got
        .post(this.rpc, {
          json: {
            jsonrpc: "2.0",
            method: "call",
            params: [
              sid,
              "adguardhome",
              "set_config",
              {
                enabled: true,
                dns_enabled: state,
              },
            ],
            id: 0,
          },
        })
        .json();
      if (!response.result) throw new Error(`Set - ${response.error.message}`);
    }
    catch (error) {
      if (this.debug) this.log.info(`🐞 - Set - Disconnected - ${error}`);
    }
  }
  // Pretty print boolean
  onOff(state) {
    return state ? "🟡 On" : "⚪️ Off";
  }
}
export default (api) => {
  hap = api.hap;
  api.registerAccessory("homebridge-adguardhome", "AdGuardHome", AdGuardHome);
};