import type { CharacteristicValue, HAP, Logging, PlatformAccessory, Service } from 'homebridge';

import type { AdGuardHomePlatform } from './platform.js';

import { crypt } from 'unixpass';
import { createHash } from 'crypto';
import got, { Got, ExtendOptions } from 'got';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class AdGuardHomePlatformAccessory {
  private service: Service;

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly name: string;
  private readonly manufacturer: string;
  private readonly model: string;
  private readonly serial: string;
  private readonly username: string;
  private readonly password: string;
  private readonly host: string;
  private readonly port: string;
  private readonly https: boolean;
  private readonly url: string;
  private readonly glinetUrl: string;
  private readonly isGlinet: boolean;
  private readonly interval: number;
  private readonly stateLogging: boolean;
  private readonly type: string;
  private readonly debug: boolean;
  private readonly autoOnTimer: number;

  // Cache for accessory status
  private currentState: CharacteristicValue;
  private targetState: CharacteristicValue;

  // Accesory States
  private onState: CharacteristicValue;
  private offState: CharacteristicValue;
  private jammedState: CharacteristicValue;

  // Services
  private autoOnHandler?: NodeJS.Timeout;
  private glinetSid?: string;
  private glinetSidTimeout?: NodeJS.Timeout;
  private gotInstance: Got;

  constructor(
    private readonly platform: AdGuardHomePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const api = this.platform.api;
    const service = this.platform.Service;
    const characteristic = this.platform.Characteristic;
    const config = this.accessory.context.device;

    this.hap = api.hap;
    this.log = this.platform.log;

    this.name = config.name;
    this.manufacturer = config.manufacturer || 'Homebridge';
    this.model = config.model || 'AdGuard Home';
    this.serial = config['serial-number'] || '123-456-789';
    this.username = config.username || '';
    this.password = config.password || '';
    this.host = config.host || 'localhost';
    this.port = config.port || 80;
    this.https = !!config.https;
    this.url = `http${this.https ? 's' : ''}://${this.host}:${this.port}`;
    this.glinetUrl = `http${this.https ? 's' : ''}://${this.host}:80/rpc`;
    this.isGlinet = config.isGlinet || false;
    this.interval = config.interval || 5;
    this.interval = this.interval * 1000;
    this.stateLogging = config.stateLogging || false;
    this.type = config.type || 'SWITCH';
    this.type = this.type.toUpperCase();
    this.autoOnTimer = config.autoOnTimer || 0;
    this.autoOnTimer = this.autoOnTimer * 60 * 1000; // Convert to miliseconds
    this.debug = this.accessory.context.debug || false;

    // Setup default states values
    this.onState = this.isLock() ? this.hap.Characteristic.LockCurrentState.SECURED : true;
    this.offState = this.isLock() ? this.hap.Characteristic.LockCurrentState.UNSECURED : false;
    this.jammedState = this.isLock() ? this.hap.Characteristic.LockCurrentState.JAMMED : this.offState;

    // Setup accesory value
    this.currentState = this.offState;
    this.targetState = this.onState;

    // Get the API default handler for regular AdGuard Home
    this.gotInstance = got.extend(this.gotOptions());

    // set accessory information
    this.accessory.getService(service.AccessoryInformation)!
      .setCharacteristic(characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(characteristic.Model, this.model)
      .setCharacteristic(characteristic.SerialNumber, this.serial);

    // Get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory

    this.service = this.isLock() ?
      this.accessory.getService(service.LockMechanism) || this.accessory.addService(service.LockMechanism) :
      this.accessory.getService(service.Switch) || this.accessory.addService(service.Switch);

    // Set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(characteristic.Name, this.name);

    // Register handlers for the On/Off Characteristic
    this.service
      .getCharacteristic(this.isLock() ? this.hap.Characteristic.LockTargetState : this.hap.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
    // Get accessories value for lock accessories
    if (this.isLock()) {
      this.service
        .getCharacteristic(this.hap.Characteristic.LockCurrentState)
        .onGet(this.getOnLock.bind(this));
    }

    // Main loop
    setInterval(() => {
      this.updateState();
    }, this.interval);

    this.log.info(`🛡️ - ${this.name} - Finish initializing!`);
  }

  // 
  // Default actions
  // 

  // Default Set and Get
  async getOn(): Promise<CharacteristicValue> {
    // No await to avoid long wait from API calls.
    // this.updateState() is called to get faster AdGuard Home state instead of waiting for the next loop.
    this.updateState();

    // Characteristic LockTargetState and On only accept secure/unsecure or true/false, 
    // current state need to be converted into those two states.
    return this.currentState === this.onState ? this.onState : this.offState;
  }
  async setOn(value: CharacteristicValue) {
    // Immedietly update HomeKit target state if current type is Lock
    this.targetState = value === this.onState ? this.onState : this.offState;
    if (this.isLock()) {
      this.service
        .getCharacteristic(this.hap.Characteristic.LockTargetState)
        .updateValue(this.targetState);
    }

    // API call, convert value to boolean
    await this.setAGHState(!!value);

    if (this.stateLogging) {
      if (this.isLock()) {
        this.log(`🛡️ - ${this.name} - Set to: ${this.targetState === this.onState ? '🔒 Locked' : '🔓 Unlocked'}`);
      } else {
        this.log(`🛡️ - ${this.name} - Set to: ${this.targetState === this.onState ? '🟡 On' : '⚪️ Off'}`);
      }
    }

    // Update the result
    await this.updateState();
  }
  // Lock Get
  async getOnLock(): Promise<CharacteristicValue> {
    // No await to avoid long wait from API calls.
    // this.updateState() is called to get faster AdGuard Home state instead of waiting for the next loop.
    this.updateState();

    return this.currentState;
  }

  // Get up to date AdGuard Home state and then update Homekit status
  private async updateState() {
    const status = await this.getAGHState();
    const skipUpdateValues = status === undefined && this.currentState !== this.jammedState;

    // Update current status
    this.currentState = status === true ? this.onState : status === false ? this.offState : this.jammedState;
    // Update target state when it's not jammed
    if (this.currentState !== this.jammedState) {
      this.targetState = this.currentState;
    }

    // Ignore the first reported jammed state for stable HomeKit report when using GL-iNet auth.
    // The GL-iNet SID could be expired when someone login into GL-iNet web UI, causing a short glitch.
    if (this.isGlinet && skipUpdateValues) {
      if (this.stateLogging) {
        this.log(`🛡️ - ${this.name} - Jammed detected.`);
      }
      return;
    }

    if (this.isLock()) {
      this.service
        .getCharacteristic(this.hap.Characteristic.LockCurrentState)
        .updateValue(this.currentState);
      this.service
        .getCharacteristic(this.hap.Characteristic.LockTargetState)
        .updateValue(this.targetState);

      if (this.stateLogging) {
        // eslint-disable-next-line max-len
        this.log(`${this.currentState === this.jammedState ? '🔐' : this.currentState === this.onState ? '🔒' : '🔓'} - ${this.name} is ${this.currentState === this.jammedState ? 'Jammed' : this.currentState === this.onState ? 'Locked' : 'Unlocked'}`);
      }
    } else {
      this.service
        .getCharacteristic(this.hap.Characteristic.On)
        .updateValue(this.currentState);

      if (this.stateLogging) {
        this.log(`${this.currentState ? '🟡' : '⚪️'} - ${this.name} is ${this.currentState ? 'On' : 'Off'}`);
      }
    }
  }


  // 
  // Helpers
  // 

  // Check if type is a Lock
  private isLock(): boolean {
    return this.type === 'LOCK' ? true : false;
  }
  // Pretty print boolean
  private onOff(state: boolean) {
    return state ? '🟡 On' : '⚪️ Off';
  }


  // 
  // API Calls
  // 

  // Generate Got options
  private gotOptions(sid: string = 'REPLACE_WITH_GLINET_SID'): ExtendOptions {
    if (this.isGlinet) {
      return {
        prefixUrl: `${this.url}/control`,
        responseType: 'json',
        headers: {
          'Cookie': `Admin-Token=${sid}`,
        },
        https: {
          rejectUnauthorized: false,
        },
      };
    } else {
      // Authorization to API
      const Authorization = `Basic ${Buffer.from(
        `${this.username}:${this.password}`,
      ).toString('base64')}`;

      return {
        prefixUrl: `${this.url}/control`,
        responseType: 'json',
        headers: {
          Authorization,
        },
        https: {
          rejectUnauthorized: false,
        },
      };
    }
  }

  // AGH API calls
  // Get AdGuard Home state
  private async getAGHState() {
    try {
      if (this.isGlinet) {
        const sid = await this.getGlinetSid();
        if (sid === undefined) {
          throw new Error('Authorization failed');
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await this.gotInstance('status').json();

      if (response) {
        if (this.debug) {
          this.log.info(`🐞 - ${this.name} - AdGuard: ${this.onOff(response.running)}, DNS: ${this.onOff(response.protection_enabled)}`);
        }
        return response.protection_enabled === true;
      } else {
        throw new Error(`${response}`);
      }

    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - Get - Disconnected - ${error}`);
      }
    }

    // Connection error -> Jammed
    return undefined;
  }
  private async setAGHState(state: boolean) {
    try {
      if (this.isGlinet) {
        const sid = await this.getGlinetSid();
        if (sid === undefined) {
          throw new Error('Authorization failed');
        }
      }

      await this.gotInstance('protection', {
        method: 'POST',
        json: {
          enabled: state,
          duration: state ? 0 : this.autoOnTimer,
        },
      }).json();
    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - Set - Disconnected - ${error}`);
      }
    }
  }

  // Glinet API calls
  // Get hash value for login
  private async getGlinetEncryption() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await got
        .post(this.glinetUrl, {
          json: {
            jsonrpc: '2.0',
            method: 'challenge',
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

        // Step2: Generate cipher text using openssl algorithm
        const cipherPassword = crypt(
          this.password,
          '$' + alg + '$' + salt + '$',
        );

        // Step3: Generate hash values for login
        const data = `${this.username}:${cipherPassword}:${nonce}`;
        const hash_value = createHash('md5').update(data).digest('hex');

        if (this.debug) {
          this.log.info(`🐞 - ${this.name} - New hash - ${hash_value}`);
        }

        return hash_value;
      } else {
        throw new Error(`No API Result - ${response.error.message}`);
      }
    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - Encryption - Disconnected - ${error}`);
      }
    }

    return undefined;
  }
  // Get GliNet API SID
  private async getGlinetSid() {
    if (this.glinetSid) {
      return this.glinetSid;
    }

    try {
      const hash_value = await this.getGlinetEncryption();

      if (hash_value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await got
          .post(this.glinetUrl, {
            json: {
              jsonrpc: '2.0',
              method: 'login',
              params: {
                username: 'root',
                hash: hash_value,
              },
              id: 0,
            },
          })
          .json();

        if (response.result) {
          this.glinetSid = response.result.sid;
          if (this.debug) {
            this.log.info(`🐞 - ${this.name} - New Sid - ${this.glinetSid}`);
          }
        } else {
          throw new Error(`No API Result: ${response.error.message}`);
        }
      } else {
        throw new Error('No hash value');
      }
    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - SID - Disconnected - ${error}`);
      }
    }

    // Reset Sid in 4 minutes
    this.glinetSidTimeout = setTimeout(() => {
      clearTimeout(this.glinetSidTimeout);
      this.glinetSid = undefined;
    }, 4 * 1000 * 60);

    this.gotInstance = got.extend(this.gotOptions(this.glinetSid));
    return this.glinetSid;
  }
}
