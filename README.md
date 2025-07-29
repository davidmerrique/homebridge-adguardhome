[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm-version](https://badgen.net/npm/v/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)
[![npm-total-downloads](https://badgen.net/npm/dt/homebridge-adguardhome)](https://www.npmjs.com/package/homebridge-adguardhome)

<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" width="150">
</p>

# Homebridge AdGuard Home

Display AdGuard Home as a lock or switch accesory.

## Notes

1. When updating from 1.5.1 to 1.6.0 you might need to re-add your accessories again in Home app.

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
      "isGlinet: false,
      "type": "LOCK",
      "autoOnTimer": [1, 2, 0, 5, 10],
      "hideNonTimer": true,
      "stateLogging": false
    }
  ]
}
```

## Available Options

- "accessory": [**Mandatory**] the plugin name.
- "name": [**Mandatory**] The name that will appear in Home app. Default: AdGuard Home.
- "username": [*Optional*] The AdGuard Home login username. Default: *empty*.
- "password": [*Optional*] The AdGuard Home login password. Default: *empty*.
- "host": [*Optional*] Hostname or IP of the AdGuard Home server. Default: localhost.
- "port": [*Optional*] The AdGuard Home server port. Default: 80.
- "https": [*Optional*] To use HTTPS or regular HTTP. Default: HTTP.
- "isGlinet": [*Optional"] Plugins will use GL-iNet router API to connect to AdGuard Home server. However the status will not be reflected inside AdGuard Home web interface, instead will be reflected inside GL-iNet web interface. Default: false.
- "Type": [*Optional*] Choose between SWITCH or LOCK. Default: *empty*.
- "autoOnTimer": [*Optional*] Auto on timer, 0 timer will be ignored. Will created multiple accessories in Home App. Default: *empty*.
- "hideNonTimer": [*Optional*] Hide non timer accesory when you set one or more timer accessory. Default: false.
- "stateLogging": [*Optional*] Display more log output. Default: false.

Or just use [Homebridge Config UI X](https://github.com/homebridge/homebridge-config-ui-x) 👀
