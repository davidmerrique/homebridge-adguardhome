var Service, Characteristic;
var got = require("got");

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-adguard", "AdGuardHome", adguard);
};

function adguard(log, config) {
  this.log = log;
  global.log = log;

  this.manufacturer = "AdGuard";
  this.name = "AdGuardHome";

  this.username = config["username"];
  this.password = config["password"];
  this.host = config["host"] || "localhost";
  this.port = config["port"] || 80;

  const Authorization = `Basic ${Buffer.from(
    `${this.username}:${this.password}`
  ).toString("base64")}`;

  this.gotInstance = got.extend({
    prefixUrl: "http://" + this.host + ":" + this.port + "/control",
    headers: {
      Authorization
    },
    responseType: "json"
  });
}

adguard.prototype.getServices = function() {
  var infoService = new Service.AccessoryInformation()
    .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .setCharacteristic(Characteristic.Model, this.model)
    .setCharacteristic(Characteristic.SerialNumber, this.serial);

  var switchService = new Service.Switch(this.name);
  switchService
    .getCharacteristic(Characteristic.On)
    .on("get", this.getStatus.bind(this))
    .on("set", this.setStatus.bind(this));

  this.informationService = infoService;
  this.switchService = switchService;

  return [this.informationService, this.switchService];
};

adguard.prototype.getStatus = function(callback) {
  this.gotInstance("status")
    .then(({ body }) => {
      callback(null, body.protection_enabled === true);
    })
    .catch(error => {
      callback(error);
    });
};

adguard.prototype.setStatus = function(newVal, callback) {
  this.gotInstance
    .post("dns_config", {
      json: {
        protection_enabled: !!newVal
      }
    })
    .then(res => {
      callback(null, res.status === 200);
    })
    .catch(error => {
      callback(error);
    });
};
