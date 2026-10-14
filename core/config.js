require('dotenv').config();

/**
 * Per-channel configuration, loaded from environment variables.
 *
 * Each channel exposes a `configured` flag: true when all its required
 * secrets are present. When false, the channel still loads but its plugin
 * is expected to run in mock mode (no real provider calls).
 */
function buildConfig(env = process.env) {
  const email = {
    provider: env.EMAIL_PROVIDER || 'mock',
    from: env.EMAIL_FROM || '',
    apiKey: env.EMAIL_API_KEY || '',
  };
  email.configured = Boolean(email.from && email.apiKey);

  const sms = {
    provider: env.SMS_PROVIDER || 'mock',
    from: env.SMS_FROM || '',
    accountSid: env.SMS_ACCOUNT_SID || '',
    authToken: env.SMS_AUTH_TOKEN || '',
  };
  sms.configured = Boolean(sms.from && sms.accountSid && sms.authToken);

  const slack = {
    token: env.SLACK_TOKEN || '',
    defaultChannel: env.SLACK_DEFAULT_CHANNEL || '#general',
  };
  slack.configured = Boolean(slack.token);

  // Queue retry policy. Falls back to sane defaults when env is unset or
  // malformed, so a bad value never silently disables retries.
  const queue = {
    maxAttempts: toPositiveInt(env.QUEUE_MAX_ATTEMPTS, 3),
    baseDelayMs: toPositiveInt(env.QUEUE_BASE_DELAY_MS, 500),
    maxDelayMs: toPositiveInt(env.QUEUE_MAX_DELAY_MS, 30000),
  };

  return { email, sms, slack, queue };
}

function toPositiveInt(raw, fallback) {
  // Number() (not parseInt) so partial values like "2.5" or "5abc" are
  // treated as malformed and fall back, rather than silently truncating.
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Redact secrets for safe logging. Keeps shape, masks sensitive values.
 */
function redact(config) {
  const SECRET_KEYS = ['apiKey', 'authToken', 'token', 'accountSid'];
  const out = {};
  for (const [channel, cfg] of Object.entries(config)) {
    out[channel] = {};
    for (const [key, val] of Object.entries(cfg)) {
      out[channel][key] =
        SECRET_KEYS.includes(key) && val ? '***redacted***' : val;
    }
  }
  return out;
}

module.exports = { buildConfig, redact };
