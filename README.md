# Homebridge AdGuard Home

This enables an On/Off switch Accessory to enable/disable AdGuard Home protection.

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
      "accessory": "AdGuardHome",
      "name": "AdGuard",
      "username": "ADGUARD_USERNAME",
      "password": "ADGUARD_PASSWORD",
      "host": "192.168.1.2",
      "https": false
    }
  ]
}
```
