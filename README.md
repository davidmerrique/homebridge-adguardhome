[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm-version](https://badgen.net/npm/v/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)
[![npm-total-downloads](https://badgen.net/npm/dt/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)

<p align="center">
<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge AdGuard Home

Display AdGuard Home as a lock or switch accesory.

## Notes

1. When updating from 1.5.1 to 1.6.0 you might need to re-add your accessories again in Home app.
2. When creating multiple timer, Home app will assign the same name for all accessories, this is expected behaviour 🤷🏽‍♂️. You need to rename them manually.

## Requirements

- [Homebridge](https://github.com/homebridge/homebridge) HomeKit support for the impatient
- [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) Network-wide ads & trackers blocking DNS server

## Example config

```json
{
  "bridge": {
    "name": "Homebridge",
    "username": "CC:22:3D:E3:CE:30",
    "port": 51826,
    "pin": "031-45-154"
  },
  "accessories": [
    {
      "accessory": "AdGuardHome",
      "name": "AdGuard",
      "username": "ADGUARD_USERNAME",
      "password": "ADGUARD_PASSWORD",
      "host": "192.168.1.2",
      "port": 80,
      "https": false,
      "Type": "LOCK",
      "autoOnTimer": [1, 2, 0, 5, 10],
      "stateLogging": false
    }
  ]
}
```

## Available Options

- "accessory": [**Mandatory**] the plugin name.
- "name": [**Mandatory**] The name that will appear in Home app.
- "username": [*Optional*] The AdGuard Home login username.
- "password": [*Optional*] The AdGuard Home login password.
- "host": [*Optional*] Hostname or IP of the AdGuard Home server, default is localhost.
- "port": [*Optional*] The AdGuard Home server port, default is 80.
- "https": [*Optional*] To use HTTPS or regular HTTP, default is HTTP.
- "Type": [*Optional*] Choose between SWITCH or LOCK, default is SWITCH.
- "autoOnTimer": [*Optional*] Auto on timer, 0 timer will be ignored. Will created multiple accessories in Home App.
- "stateLogging": [*Optional*] Display more log output.

Or just use [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x) 👀
