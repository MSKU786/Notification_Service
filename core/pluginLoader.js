const fs = require('fs');
const path = require('path');

function loadPlugins() {
  const pluginsDir = path.join(__dirname, '../plugins');
  const plugins = {};

  fs.readdirSync(pluginsDir).forEach((folder) => {
    const pluginPath = path.join(pluginsDir, folder, 'index.js');
    const plugin = require(pluginPath);
    plugins[plugin.name] = plugin;
  });

  return plugins;
}

module.exports = { loadPlugins };
