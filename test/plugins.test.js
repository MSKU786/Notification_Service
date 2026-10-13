const { test } = require('node:test');
const assert = require('node:assert');

const email = require('../plugins/email');
const sms = require('../plugins/sms');
const slack = require('../plugins/slack');

const context = { logger: { info() {}, log() {}, warn() {}, error() {} } };

test('every plugin exposes the contract (name, send, init)', () => {
  for (const p of [email, sms, slack]) {
    assert.strictEqual(typeof p.name, 'string');
    assert.ok(p.name.length > 0);
    assert.strictEqual(typeof p.send, 'function');
    assert.strictEqual(typeof p.init, 'function');
  }
  assert.deepStrictEqual(
    [email.name, sms.name, slack.name],
    ['email', 'sms', 'slack']
  );
});

test('init stores the channel config on the plugin', () => {
  email.init({ from: 'x@y.com', configured: true });
  assert.strictEqual(email.config.from, 'x@y.com');
  email.init(); // tolerates missing config
  assert.deepStrictEqual(email.config, {});
});

test('email: requires a "to" address', async () => {
  email.init({});
  await assert.rejects(
    () => email.send({ message: 'hi' }, context),
    /requires a "to" address/
  );
});

test('email: sends in mock mode and returns a delivery receipt', async () => {
  email.init({ from: 'sender@x.com', configured: false });
  const res = await email.send(
    { to: 'a@b.com', message: 'hi', meta: { subject: 'Hello' } },
    context
  );
  assert.strictEqual(res.channel, 'email');
  assert.strictEqual(res.to, 'a@b.com');
  assert.strictEqual(res.from, 'sender@x.com');
  assert.strictEqual(res.subject, 'Hello');
  assert.strictEqual(res.mode, 'mock');
  assert.match(res.messageId, /^email_/);
  assert.ok(res.deliveredAt);
});

test('email: defaults subject and reports live mode when configured', async () => {
  email.init({ from: 'sender@x.com', configured: true });
  const res = await email.send({ to: 'a@b.com', message: 'hi' }, context);
  assert.strictEqual(res.subject, 'Notification');
  assert.strictEqual(res.mode, 'live');
});

test('sms: requires a "to" number', async () => {
  sms.init({});
  await assert.rejects(
    () => sms.send({ message: 'hi' }, context),
    /requires a "to" phone number/
  );
});

test('sms: sends in mock mode with a from and receipt', async () => {
  sms.init({ from: '+15550001111', configured: false });
  const res = await sms.send({ to: '+1999', message: 'yo' }, context);
  assert.strictEqual(res.channel, 'sms');
  assert.strictEqual(res.to, '+1999');
  assert.strictEqual(res.from, '+15550001111');
  assert.strictEqual(res.mode, 'mock');
  assert.match(res.messageId, /^sms_/);
});

test('slack: resolves channel from "to", then meta, then default', async () => {
  slack.init({ defaultChannel: '#fallback' });

  const explicit = await slack.send({ to: '#direct', message: 'x' }, context);
  assert.strictEqual(explicit.to, '#direct');

  const viaMeta = await slack.send(
    { message: 'x', meta: { channel: '#from-meta' } },
    context
  );
  assert.strictEqual(viaMeta.to, '#from-meta');

  const viaDefault = await slack.send({ message: 'x' }, context);
  assert.strictEqual(viaDefault.to, '#fallback');
});

test('slack: reports live mode when configured', async () => {
  slack.init({ defaultChannel: '#general', configured: true });
  const res = await slack.send({ message: 'x' }, context);
  assert.strictEqual(res.channel, 'slack');
  assert.strictEqual(res.mode, 'live');
  assert.match(res.messageId, /^slack_/);
});
