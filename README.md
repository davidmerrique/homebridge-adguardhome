# Homebridge AdGuard Home

Display AdGuard Home as a lock or switch accesory.

NOTE: When updating from 1.5.1 to 1.6.0 you might need to re-add the accessory again.

## Requirements

- [Homebridge](https://github.com/nfarina/homebridge) HomeKit support for the impatient
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
      "accessory": "AdGuardHome", // [Mandatory] the plugin name.
      "name": "AdGuard", // [Mandatory] The name that will appear in Home app.
      "username": "ADGUARD_USERNAME", // [Optional] The AdGuard Home login username.
      "password": "ADGUARD_PASSWORD", // [Optional] The AdGuard Home login password.
      "host": "192.168.1.2", // [Mandatory] Hostname or IP of the AdGuard Home server, default is localhost.
      "port": 80, // [Optional] The AdGuard Home server port, default is 80.
      "https": false, // [Optional] To use HTTPS or regular HTTP, default is HTTP.
      "Type": "LOCK", // [Optional] Choose between SWITCH or LOCK, default is SWITCH.
      "autoOnTimer": [ 1, 2, 0, 5, 10], // [Optional] Auto on timer, 0 timer will be ignored. Will created multiple accessories in Home App.
      "stateLogging": false, // [Optional] Display more log output.
    }
  ]
}
```
