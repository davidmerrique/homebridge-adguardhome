[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm-version](https://badgen.net/npm/v/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)
[![npm-total-downloads](https://badgen.net/npm/dt/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)

<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" width="150">
</p>

# Homebridge AdGuard Home

Display AdGuard Home as a lock or switch accessory.

## Before Installing

1. When updating from 1.5.1 to 1.6.0 you might need to re-add your accessories again in Home app.
2. Version 2.0.0 introduce breaking changes:
    1. Remove any homebridge-adguardhome old accessories and add the new bridge and accessory in Home app.
    2. Remove old homebridge-adguardhome old from config.json. The old configuration should be inside `accessories: []`.
    3. Restart Homebridge and Homebridge Config UI X for changes to take effect, and before adding new homebridge-adguardhome accesory from Homebridge Config UI X.

## Requirements

- [Homebridge](https://github.com/homebridge/homebridge) HomeKit support for the impatient.
- [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) Network-wide ads & trackers blocking DNS server, or
- GL-iNet router with integrated AdGuard Home (*optional*).

## config.json example

```json
{
  "bridge": {
    "name": "Homebridge",
    "username": "AA:AA:AA:AA:AA:AA",
    "port": 51826,
    "pin": "123-45-678"
  },
  "platforms": [
    {
      "accessories": [
        {
          "name": "AdGuard Home",
          "username": "ADGUARD_USERNAME",
          "password": "ADGUARD_PASSWORD",
          "https": false,
          "host": "192.168.1.1",
          "port": 3000,
          "glinetport": 80,
          "isGlinet": false,
          "interval": 5,
          "type": "LOCK",
          "autoOnTimer": 0,
          "stateLogging": false
        }
      ],
      "debug": false,
      "platform": "AdGuardHome"
    }
  ],
  "disabledPlugins": [],
  "accessories": []
}
```

## Available Options

Accesories options:

- "name": [**Mandatory**] The name that will appear in Home app. Please provide unique name for eact accessory. Default: AdGuard Home.
- "username": [**Mandatory**] The AdGuard Home login username. Default: *empty*.
- "password": [**Mandatory**] The AdGuard Home login password. Default: *empty*.
- "https": [*Optional*] To use HTTPS or regular HTTP. Default: HTTP.
- "host": [*Optional*] Hostname or IP of the AdGuard Home server. Default: localhost.
- "port": [*Optional*] The AdGuard Home server port. Default: 3000.
- "glinetport": [*Optional*] The Gl-iNet router port. Default: 80.
- "isGlinet": [*Optional"] Plugins will use GL-iNet router API to connect to AdGuard Home server. However the status will not be reflected inside AdGuard Home web interface, instead will be reflected inside GL-iNet web interface. Default: false.
- "interval": [*Optional*] How often the plugins check the servers status, in seconds . Default: *5*.
- "type": [*Optional*] Choose between SWITCH or LOCK. Default: *empty*.
- "autoOnTimer": [*Optional*] Auto on timer, 0 timer will be ignored. Default: *empty*.
- "stateLogging": [*Optional*] Display more log output. Default: false.

Platform options:

- "debug": [*Optional*] Output debug log to Homebdirg log. Default: false.
- "platform": [**Mandatory**] Default: "AdGuardHome".

Or you can use use [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x).
