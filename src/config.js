const fs = require("fs");
const path = require("path");

const defaultConfigPath = path.join(__dirname, "config.json");
const localConfigPath = path.join(__dirname, "config.local.json");

const configPath = fs.existsSync(localConfigPath)
  ? localConfigPath
  : defaultConfigPath;

module.exports = require(configPath);