const smsPlugin = {
  name: 'sms',
  config: {},

  init(config) {
    this.config = config || {};
  },

  send: async function ({ to, message }, context) {
    if (!to) throw new Error('sms requires a "to" phone number');
    const from = this.config.from || '+15550000000';
    const provider = this.config.provider || 'mock';

    // Real sending only when a non-mock provider is set AND its secrets are
    // present; otherwise fall back to mock so the service runs with no creds.
    const live = this.config.configured && provider !== 'mock';
    if (!live) {
      context.logger.info(`[SMS Plugin:mock] ${from} -> ${to}: ${message}`);
      await new Promise((res) => setTimeout(res, 200));
      return receipt({ to, from, mode: 'mock' });
    }

    if (provider === 'twilio') {
      return this._sendViaTwilio({ to, from, message }, context);
    }
    throw new Error(`sms: unsupported provider "${provider}"`);
  },

  // Twilio Messages API. Form-encoded POST with Basic auth (SID:authToken).
  async _sendViaTwilio({ to, from, message }, context) {
    const doFetch = (context && context.fetch) || globalThis.fetch;
    const { accountSid, authToken } = this.config;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    context.logger.info(`[SMS Plugin:live:twilio] ${from} -> ${to}`);
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`twilio responded ${res.status}: ${body}`);
    }
    const json = await res.json();
    return receipt({
      to,
      from,
      mode: 'live',
      provider: 'twilio',
      messageId: json.sid || `sms_${Date.now()}`,
    });
  },
};

function receipt({ to, from, mode, provider, messageId }) {
  return {
    channel: 'sms',
    to,
    from,
    mode,
    ...(provider ? { provider } : {}),
    messageId: messageId || `sms_${Date.now()}`,
    deliveredAt: new Date().toISOString(),
  };
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}

module.exports = smsPlugin;
