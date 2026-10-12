const { test } = require('node:test');
const assert = require('node:assert');
const { buildConfig, redact } = require('../core/config');

test('falls back to mock defaults when env is empty', () => {
  const cfg = buildConfig({});
  assert.strictEqual(cfg.email.provider, 'mock');
  assert.strictEqual(cfg.sms.provider, 'mock');
  assert.strictEqual(cfg.slack.defaultChannel, '#general');
  assert.strictEqual(cfg.email.configured, false);
  assert.strictEqual(cfg.sms.configured, false);
  assert.strictEqual(cfg.slack.configured, false);
});

test('email is configured only with both from and apiKey', () => {
  assert.strictEqual(buildConfig({ EMAIL_FROM: 'a@b.com' }).email.configured, false);
  assert.strictEqual(buildConfig({ EMAIL_API_KEY: 'k' }).email.configured, false);
  assert.strictEqual(
    buildConfig({ EMAIL_FROM: 'a@b.com', EMAIL_API_KEY: 'k' }).email.configured,
    true
  );
});

test('sms is configured only with from, sid and token', () => {
  const partial = buildConfig({ SMS_FROM: '+1', SMS_ACCOUNT_SID: 'sid' });
  assert.strictEqual(partial.sms.configured, false);

  const full = buildConfig({
    SMS_FROM: '+1',
    SMS_ACCOUNT_SID: 'sid',
    SMS_AUTH_TOKEN: 'tok',
  });
  assert.strictEqual(full.sms.configured, true);
});

test('slack is configured once a token is present', () => {
  assert.strictEqual(buildConfig({ SLACK_TOKEN: 'xoxb-1' }).slack.configured, true);
  assert.strictEqual(
    buildConfig({ SLACK_DEFAULT_CHANNEL: '#ops' }).slack.defaultChannel,
    '#ops'
  );
});

test('redact masks secrets but keeps shape and non-secrets', () => {
  const cfg = buildConfig({
    EMAIL_FROM: 'a@b.com',
    EMAIL_API_KEY: 'super-secret',
    SMS_AUTH_TOKEN: 'tok',
    SMS_ACCOUNT_SID: 'sid',
    SLACK_TOKEN: 'xoxb-1',
  });
  const out = redact(cfg);

  assert.strictEqual(out.email.apiKey, '***redacted***');
  assert.strictEqual(out.sms.authToken, '***redacted***');
  assert.strictEqual(out.sms.accountSid, '***redacted***');
  assert.strictEqual(out.slack.token, '***redacted***');
  // non-secret fields pass through untouched
  assert.strictEqual(out.email.from, 'a@b.com');
  assert.strictEqual(out.email.provider, 'mock');
});

test('redact leaves empty secret values as-is (nothing to hide)', () => {
  const out = redact(buildConfig({}));
  assert.strictEqual(out.email.apiKey, '');
  assert.strictEqual(out.slack.token, '');
});

test('redact does not mutate the input config', () => {
  const cfg = buildConfig({ EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.com' });
  redact(cfg);
  assert.strictEqual(cfg.email.apiKey, 'k');
});
