const fs = require('fs');
const path = require('path');

function loadPlugins() {
  const pluginsDir = path.join(__dirname, '../plugins');
  const plugins = {};

  if (!fs.existsSync(pluginsDir)) return plugins;

  fs.readdirSync(pluginsDir).forEach((folder) => {
    if (folder.startsWith('.')) return; // skip hidden files

    const pluginIndex = path.join(pluginsDir, folder, 'index.js');
    try {
      if (!fs.existsSync(pluginIndex)) {
        console.warn(`Plugin "${folder}" has no index.js, skipping.`);
        return;
      }

      const required = require(pluginIndex);

      // support either direct export (module.exports = plugin)
      // or named export (module.exports = { slackPlugin })
      let plugin = required;
      if (
        required &&
        typeof required === 'object' &&
        Object.keys(required).length === 1
      ) {
        const val = required[Object.keys(required)[0]];
        if (val && val.name && typeof val.send === 'function') plugin = val;
      }

      if (!plugin || !plugin.name || typeof plugin.send !== 'function') {
        console.warn(
          `Plugin "${folder}" does not export a valid plugin, skipping.`
        );
        return;
      }

      plugins[plugin.name] = plugin;
    } catch (err) {
      console.warn(`Failed loading plugin "${folder}": ${err.message}`);
    }
  });

  return plugins;
}

module.exports = { loadPlugins };
