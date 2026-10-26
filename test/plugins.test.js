const { test } = require('node:test');
const assert = require('node:assert');

const email = require('../plugins/email');
const sms = require('../plugins/sms');
const slack = require('../plugins/slack');

const logger = { info() {}, log() {}, warn() {}, error() {} };
const context = { logger };

// Build a context whose injected fetch records the request and returns a
// scripted response, so the live provider paths never touch the network.
function withFetch(response) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    return response;
  };
  return { ctx: { logger, fetch }, calls };
}

function fakeResponse({ ok = true, status = 200, headers = {}, body = '', json } = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null },
    text: async () => body,
    json: async () => (json !== undefined ? json : JSON.parse(body || '{}')),
  };
}

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

test('email: configured but provider "mock" stays in mock mode', async () => {
  email.init({ from: 'sender@x.com', provider: 'mock', configured: true });
  const { ctx, calls } = withFetch(fakeResponse());
  const res = await email.send({ to: 'a@b.com', message: 'hi' }, ctx);
  assert.strictEqual(res.mode, 'mock');
  assert.strictEqual(res.subject, 'Notification'); // default subject
  assert.strictEqual(calls.length, 0); // never calls the provider
});

test('email: live sendgrid send posts the right request and returns a receipt', async () => {
  email.init({
    from: 'sender@x.com',
    provider: 'sendgrid',
    apiKey: 'SG.key',
    configured: true,
  });
  const { ctx, calls } = withFetch(
    fakeResponse({ status: 202, headers: { 'x-message-id': 'sg-123' } })
  );
  const res = await email.send(
    { to: 'a@b.com', message: 'hi', meta: { subject: 'Hey' } },
    ctx
  );
  assert.strictEqual(res.mode, 'live');
  assert.strictEqual(res.provider, 'sendgrid');
  assert.strictEqual(res.messageId, 'sg-123');

  assert.strictEqual(calls.length, 1);
  const { url, opts } = calls[0];
  assert.strictEqual(url, 'https://api.sendgrid.com/v3/mail/send');
  assert.strictEqual(opts.headers.Authorization, 'Bearer SG.key');
  const payload = JSON.parse(opts.body);
  assert.strictEqual(payload.personalizations[0].to[0].email, 'a@b.com');
  assert.strictEqual(payload.from.email, 'sender@x.com');
  assert.strictEqual(payload.subject, 'Hey');
  assert.strictEqual(payload.content[0].value, 'hi');
});

test('email: a non-2xx provider response throws (so the queue retries)', async () => {
  email.init({ from: 'a@x.com', provider: 'sendgrid', apiKey: 'k', configured: true });
  const { ctx } = withFetch(fakeResponse({ ok: false, status: 401, body: 'unauthorized' }));
  await assert.rejects(
    () => email.send({ to: 'a@b.com', message: 'hi' }, ctx),
    /sendgrid responded 401: unauthorized/
  );
});

test('email: an unsupported live provider throws', async () => {
  email.init({ from: 'a@x.com', provider: 'mailgun', apiKey: 'k', configured: true });
  await assert.rejects(
    () => email.send({ to: 'a@b.com', message: 'hi' }, context),
    /unsupported provider "mailgun"/
  );
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

test('sms: live twilio send posts form-encoded body with basic auth', async () => {
  sms.init({
    from: '+15550001111',
    provider: 'twilio',
    accountSid: 'AC123',
    authToken: 'tok',
    configured: true,
  });
  const { ctx, calls } = withFetch(fakeResponse({ status: 201, json: { sid: 'SM999' } }));
  const res = await sms.send({ to: '+1999', message: 'yo' }, ctx);
  assert.strictEqual(res.mode, 'live');
  assert.strictEqual(res.provider, 'twilio');
  assert.strictEqual(res.messageId, 'SM999');

  assert.strictEqual(calls.length, 1);
  const { url, opts } = calls[0];
  assert.strictEqual(url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
  assert.strictEqual(
    opts.headers.Authorization,
    `Basic ${Buffer.from('AC123:tok').toString('base64')}`
  );
  const params = new URLSearchParams(opts.body);
  assert.strictEqual(params.get('To'), '+1999');
  assert.strictEqual(params.get('From'), '+15550001111');
  assert.strictEqual(params.get('Body'), 'yo');
});

test('sms: a non-2xx twilio response throws', async () => {
  sms.init({ from: '+1', provider: 'twilio', accountSid: 'AC', authToken: 't', configured: true });
  const { ctx } = withFetch(fakeResponse({ ok: false, status: 400, body: 'bad number' }));
  await assert.rejects(
    () => sms.send({ to: '+1999', message: 'yo' }, ctx),
    /twilio responded 400: bad number/
  );
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

test('slack: live send posts to chat.postMessage and returns the ts', async () => {
  slack.init({ token: 'xoxb-1', defaultChannel: '#general', configured: true });
  const { ctx, calls } = withFetch(
    fakeResponse({ json: { ok: true, ts: '1700.1', channel: 'C123' } })
  );
  const res = await slack.send({ to: '#ops', message: 'deploy done' }, ctx);
  assert.strictEqual(res.mode, 'live');
  assert.strictEqual(res.to, 'C123'); // echoes the resolved channel from Slack
  assert.strictEqual(res.messageId, '1700.1');

  assert.strictEqual(calls.length, 1);
  const { url, opts } = calls[0];
  assert.strictEqual(url, 'https://slack.com/api/chat.postMessage');
  assert.strictEqual(opts.headers.Authorization, 'Bearer xoxb-1');
  const payload = JSON.parse(opts.body);
  assert.strictEqual(payload.channel, '#ops');
  assert.strictEqual(payload.text, 'deploy done');
});

test('slack: a 200 with { ok:false } is treated as a failure and throws', async () => {
  slack.init({ token: 'xoxb-1', configured: true });
  const { ctx } = withFetch(fakeResponse({ json: { ok: false, error: 'channel_not_found' } }));
  await assert.rejects(
    () => slack.send({ to: '#nope', message: 'x' }, ctx),
    /slack API error: channel_not_found/
  );
});
