import type {
  CharacteristicValue,
  HAP,
  Logging,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { AdGuardHomePlatform } from './platform.js';

import * as fs from 'node:fs';
import got, { Got } from 'got';
import { crypt } from 'unixpass';
import { createHash } from 'crypto';

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
  private readonly rpc: string;
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
  private unknownState: CharacteristicValue;
  private jammedState: CharacteristicValue;

  // Services
  private onAPICall: boolean;
  private autoOnHandler?: NodeJS.Timeout;
  private glinetSid?: string;
  private glinetSidTimeout?: NodeJS.Timeout;

  private readonly storageName: string;
  private readonly gotInstance?: Got;

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
    this.rpc = `${this.url}/rpc`;
    this.isGlinet = config.isGlinet || false;
    this.interval = config.interval || 5000;
    this.stateLogging = config.stateLogging || false;
    this.type = config.type || 'SWITCH';
    this.type = this.type.toUpperCase();
    this.autoOnTimer = config.autoOnTimer || 0;
    this.debug = this.accessory.context.debug || false;

    // Setup default states values
    this.onState = this.isLock() ? this.hap.Characteristic.LockCurrentState.SECURED : true;
    this.offState = this.isLock() ? this.hap.Characteristic.LockCurrentState.UNSECURED : false;
    this.unknownState = this.isLock() ? this.hap.Characteristic.LockCurrentState.UNKNOWN : this.offState;
    this.jammedState = this.isLock() ? this.hap.Characteristic.LockCurrentState.JAMMED : this.offState;
    this.currentState = this.offState;
    this.targetState = this.offState;

    // Get storage path
    this.storageName = `${api.user.storagePath()}/adguardhome-${config.UUID}-timer.config`;

    // Set initial state of onAPIcall
    this.onAPICall = false;


    // Get API handle for regular AdGuard Home server
    if (!this.isGlinet) {
      // Authorization to API
      const Authorization = `Basic ${Buffer.from(
        `${this.username}:${this.password}`,
      ).toString('base64')}`;

      // Get the API default handler
      this.gotInstance = got.extend({
        prefixUrl: `${this.url}/control`,
        responseType: 'json',
        headers: {
          Authorization,
        },
        https: {
          rejectUnauthorized: false,
        },
      });
    }

    // set accessory information
    this.accessory.getService(service.AccessoryInformation)!
      .setCharacteristic(characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(characteristic.Model, this.model)
      .setCharacteristic(characteristic.SerialNumber, this.serial);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory

    this.service = this.isLock() ?
      this.accessory.getService(service.LockMechanism) || this.accessory.addService(service.LockMechanism) :
      this.accessory.getService(service.Switch) || this.accessory.addService(service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(characteristic.Name, this.name);

    // register handlers for the On/Off Characteristic
    this.assignDefaultEvents(this.service);

    // Main loop
    this.loopStates();

    // Check if there is previous unfinished timer, and run it again
    this.checkUnfinishedTimer();

    this.log.info(`🛡️ - ${this.name} - Finish initializing!`);
  }

  // Check if typle is a Lock
  private isLock(): boolean {
    return this.type === 'LOCK' ? true : false;
  }
  // Check if state is jammed
  private isJammed(): boolean {
    return this.type === 'LOCK' ? this.currentState === this.hap.Characteristic.LockCurrentState.JAMMED : this.currentState === 'JAMMED';
  }

  // Assign default events to timer accessories
  private assignDefaultEvents(service: Service) {
    service
      .getCharacteristic(this.isLock() ? this.hap.Characteristic.LockTargetState : this.hap.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    if (this.isLock()) {
      service
        .getCharacteristic(this.hap.Characteristic.LockCurrentState)
        // Get accessories value for lock accessories
        .onGet(this.getOnLock.bind(this));
    }
  }

  // Default Set and Get
  async getOn(): Promise<CharacteristicValue> {
    return this.targetState;
  }
  async setOn(value: CharacteristicValue) {
    this.setAdGuardHome(value);

    if (this.autoOnHandler !== undefined) {
      this.log.info('⏲️ - ${this.name} - Clearing previous timer');
      clearTimeout(this.autoOnHandler);
    }

    // Do the timer
    if (this.autoOnTimer > 0 && value === this.offState) {
      this.runTimer(this.autoOnTimer);
    }
  }

  // Lock Get
  async getOnLock(): Promise<CharacteristicValue> {
    // Limit API call one in a time
    if (!this.onAPICall) {
      this.onAPICall = true;

      if (this.isGlinet) {
        // Glinet stuff
        const run = async () => {
          const status = await this.getGlinetState();

          if (status !== undefined) {
            this.currentState = status ? this.onState : this.offState;
          } else {
            this.currentState = this.jammedState;
          }

          this.onAPICall = false;
          this.service
            .getCharacteristic(this.hap.Characteristic.LockCurrentState)
            .updateValue(this.currentState);
        };

        run();
      } else if (this.gotInstance) {
        this.gotInstance('status')
          .json()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((body: any) => {
            const enabled = body.protection_enabled === true;
            if (this.stateLogging) {
              this.log.info(`🛡️ - ${this.name} - Current state: ${enabled ? '🔒 Locked' : '🔓 Unlocked'}`);
            }
            this.currentState = enabled ? this.onState : this.offState;
          })
          .catch((error) => this.accessoryIsOffline(error))
          .then(() => {
            this.onAPICall = false;
            this.service
              .getCharacteristic(this.hap.Characteristic.LockCurrentState)
              .updateValue(this.currentState);
          });
      }
    }

    return this.currentState;
  }

  // Looping state
  private loopStates() {
    const run = async () => {
      if (this.isGlinet) {
        const status = await this.getGlinetState();

        if (status !== undefined) {
          this.targetState = status ? this.onState : this.offState;
        } else {
          if (this.isJammed()) {
            this.currentState = this.isLock() ? this.unknownState : this.jammedState;
            if (this.stateLogging) {
              this.log.info('🛡️ - ${this.name} - 😢 Device is jammed');
            }
          }

          this.accessoryIsOffline('Can\'t reach GliNet');
        }

        this.updateStates();
      } else if (this.gotInstance) {
        this.gotInstance('status')
          .json()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((body: any) => {
            const enabled = body.protection_enabled === true;
            this.targetState = enabled ? this.onState : this.offState;
            if (this.isJammed()) {
              this.currentState = this.isLock() ? this.unknownState : this.jammedState;
              if (this.stateLogging) {
                this.log.info('🛡️ - ${this.name} - 😢 Device is jammed');
              }
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
  // Update Homekit status
  private updateStates() {
    if (this.isJammed()) {
      // If jammed, output jammed status
      this.service
        .getCharacteristic(this.isLock() ? this.hap.Characteristic.LockCurrentState : this.hap.Characteristic.On)
        .updateValue(this.jammedState);
    } else if (this.currentState !== this.targetState) {
      // Update to target state
      this.currentState = this.targetState === this.onState ? this.onState : this.offState;

      if (this.isLock()) {
        this.service
          .getCharacteristic(this.hap.Characteristic.LockCurrentState)
          .updateValue(this.currentState);
        this.service
          .getCharacteristic(this.hap.Characteristic.LockTargetState)
          .updateValue(this.targetState);
      } else {
        this.service
          .getCharacteristic(this.hap.Characteristic.On)
          .updateValue(this.currentState);
      }

      if (this.stateLogging) {
        this.log(`🛡️ - ${this.name} - Current status: ${this.currentState ? '🔒 Locked' : '🔓 Unlocked'}`);
      }
    }
  }
  // Make the accesory offline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private accessoryIsOffline(error: any) {
    if (!this.isJammed()) {
      if (this.debug) {
        if (error.response) {
          this.log.error(`🐞 - ${this.name} - Offline - ${error.response.body}`);
        } else {
          this.log.error(`🐞 - ${this.name} - Offline - ${error}`);
        }
      } else if ((this.isGlinet && this.glinetSid !== undefined) || !this.isGlinet) {
        this.log.info(`🫥 - ${this.name} - Device is offline or unreachable`);
      } 

      this.currentState = this.jammedState;
    }

    // Clear Sid since server is offline
    if(this.isGlinet) {
      this.glinetSid = undefined;
    }
  }

  // Set AdGuard Home state, on or off
  private async setAdGuardHome(status: CharacteristicValue) {
    if (this.isGlinet) {
      // Glinet stuff
      await this.setGlinetState(!!status);
      this.targetState = status === this.onState ? this.onState : this.offState;
      this.updateStates();
    } else if (this.gotInstance) {
      this.gotInstance
        .post('dns_config', {
          json: {
            protection_enabled: !!status,
          },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((res: any) => {
          const enabled = res.statusCode === 200;
          if (this.stateLogging && enabled) {
            this.log.info('🛡️ - ${this.name} - Command success');
          }

          this.targetState =
            status === this.onState ? this.onState : this.offState;
          this.log.info(`🛡️ - ${this.name} - Set to: ${status === this.onState ? '🔒 Locked' : '🔓 Unlocked'}`);

          this.updateStates();
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((error: any) => this.accessoryIsOffline(error));
    }
  }

  // Running timers
  private runTimer(timer: number, fromCheckUnfinishedTimer = false) {
    timer = Math.round(timer * 100) / 100;

    // eslint-disable-next-line max-len
    this.log.info(`⏲️ - ${this.name} - ${fromCheckUnfinishedTimer ? 'Unfinished timer, ' : ''}AdGuardHome will be locked in ${timer} minute${timer > 1 ? 's' : ''}`);

    const offTimer = new Date().getTime() + timer * 1000 * 60;
    this.writeTimerStorage(`${offTimer}`);

    this.autoOnHandler = setTimeout(
      () => {
        this.log.info(`⏲️ - ${this.name} - The ${timer} minute${timer > 1 ? 's' : ''} timer finish`);
        this.setAdGuardHome(this.onState);
        this.autoOnHandler = undefined;
        this.writeTimerStorage('0');
      },
      timer * 1000 * 60,
    );
  }
  // Check if theres unfinished timer, usefull when server got restarted when a timer is running
  private checkUnfinishedTimer() {
    this.createTimerStorage().then(() => {
      this.readTimerStorage().then((timer) => {
        const timerNumber = Number(timer);

        if (Number.isNaN(timerNumber)) {
          this.writeTimerStorage('0');
          return;
        }
        if (timerNumber === 0) {
          return;
        }

        const now = new Date().getTime();
        const delta = (timerNumber - now) / (1000 * 60);
        const finalDelta = delta < 0 ? 0 : delta > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : delta;

        this.runTimer(finalDelta, true);
      });
    });
  }

  // Timer
  // Create timer storage
  private createTimerStorage(): Promise<void> {
    return new Promise((resolve) => {
      fs.access(this.storageName, fs.constants.F_OK, (err) => {
        if (err) {
          this.writeTimerStorage('0');
        }
        resolve();
      });
    });
  }
  // Write timer to file, usually named as: adguardhome-uuid-timer.config
  private writeTimerStorage(timer: string) {
    fs.writeFile(this.storageName, timer, 'utf8', (err) => {
      if (err) {
        this.log.info('🛡️ - ${this.name} - Error writing to the file:', err);
      }
    });
  }
  // Read timer config from file.
  private readTimerStorage(): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(this.storageName, 'utf8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  // Glinet API calls
  // Get hash value for login
  private async getGlinetEncryption() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await got
        .post(this.rpc, {
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
  private async getGlinetSID() {
    if (this.glinetSid) {
      return this.glinetSid;
    }

    try {
      const hash_value = await this.getGlinetEncryption();

      if (hash_value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await got
          .post(this.rpc, {
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
    if (this.glinetSidTimeout) {
      clearTimeout(this.glinetSidTimeout);
    }
    this.glinetSidTimeout = setTimeout(
      () => {
        this.glinetSid = undefined;
      },
      4 * 1000 * 60,
    );

    return this.glinetSid;
  }
  // Get GliNet AdGuard Home state
  private async getGlinetState() {
    try {
      const sid = await this.getGlinetSID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await got
        .post(this.rpc, {
          json: {
            jsonrpc: '2.0',
            method: 'call',
            params: [sid, 'adguardhome', 'get_config'],
            id: 0,
          },
        })
        .json();

      if (response.result) {
        if (this.debug) {
          this.log.info(`🐞 - ${this.name} - AdGuard: ${this.onOff(response.result.enabled)}, DNS: ${this.onOff(response.result.dns_enabled)}`);
        }

        // Return AdGuard Home state
        return response.result.enabled && response.result.dns_enabled;
      } else {
        throw new Error(`Get - ${response.error.message}`);
      }
    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - Get - Disconnected - ${error}`);
      }
    }

    // Connection error -> Jammed
    return undefined;
  }
  // Set GliNet AdGuard Home state
  private async setGlinetState(state: boolean) {
    try {
      const sid = await this.getGlinetSID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await got
        .post(this.rpc, {
          json: {
            jsonrpc: '2.0',
            method: 'call',
            params: [
              sid,
              'adguardhome',
              'set_config',
              {
                enabled: true,
                dns_enabled: state,
              },
            ],
            id: 0,
          },
        })
        .json();

      if (!response.result) {
        throw new Error(`Set - ${response.error.message}`);
      }
    } catch (error) {
      if (this.debug) {
        this.log.info(`🐞 - ${this.name} - Set - Disconnected - ${error}`);
      }
    }
  }

  // Pretty print boolean
  private onOff(state: boolean) {
    return state ? '🟡 On' : '⚪️ Off';
  }
}
