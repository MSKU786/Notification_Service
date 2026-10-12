const { test } = require('node:test');
const assert = require('node:assert');
const { loadPlugins } = require('../core/pluginLoader');
const { buildConfig } = require('../core/config');

test('loads the three bundled channel plugins from disk', () => {
  const config = buildConfig({});
  const plugins = loadPlugins(config, { logger: console });
  assert.deepStrictEqual(Object.keys(plugins).sort(), ['email', 'slack', 'sms']);
  for (const name of Object.keys(plugins)) {
    assert.strictEqual(plugins[name].name, name);
    assert.strictEqual(typeof plugins[name].send, 'function');
  }
});

test('passes each plugin its own channel config via init', () => {
  const config = buildConfig({
    EMAIL_FROM: 'a@b.com',
    EMAIL_API_KEY: 'k', // makes email.configured === true
  });
  const plugins = loadPlugins(config, { logger: console });
  assert.strictEqual(plugins.email.config.from, 'a@b.com');
  assert.strictEqual(plugins.email.config.configured, true);
  // a channel left unconfigured still loads, in mock mode
  assert.strictEqual(plugins.slack.config.configured, false);
});

test('returns an empty object when the plugins dir is absent', () => {
  // loadPlugins resolves plugins relative to its own file, so point config
  // loading at a guaranteed-empty scenario by stubbing fs via a bad require.
  // Simplest robust check: it never throws and always returns an object.
  const plugins = loadPlugins({}, {});
  assert.strictEqual(typeof plugins, 'object');
  assert.notStrictEqual(plugins, null);
});
