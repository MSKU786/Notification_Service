const emailPlugin = {
  name: 'email',
  config: {},

  init(config) {
    this.config = config || {};
  },

  send: async function ({ to, message, meta }, context) {
    if (!to) throw new Error('email requires a "to" address');
    const subject = (meta && meta.subject) || 'Notification';
    const from = this.config.from || 'no-reply@example.com';
    const provider = this.config.provider || 'mock';

    // Real sending only when a non-mock provider is set AND its secrets are
    // present; otherwise fall back to mock so the service runs with no creds.
    const live = this.config.configured && provider !== 'mock';
    if (!live) {
      context.logger.info(
        `[Email Plugin:mock] ${from} -> ${to} ("${subject}"): ${message}`
      );
      await new Promise((res) => setTimeout(res, 250));
      return receipt({ to, from, subject, mode: 'mock' });
    }

    if (provider === 'sendgrid') {
      return this._sendViaSendgrid({ to, from, subject, message }, context);
    }
    throw new Error(`email: unsupported provider "${provider}"`);
  },

  // SendGrid v3 Mail Send. A 2xx (202 Accepted) means queued for delivery.
  async _sendViaSendgrid({ to, from, subject, message }, context) {
    const doFetch = (context && context.fetch) || globalThis.fetch;
    context.logger.info(`[Email Plugin:live:sendgrid] ${from} -> ${to}`);
    const res = await doFetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/plain', value: message }],
      }),
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`sendgrid responded ${res.status}: ${body}`);
    }
    const messageId =
      (res.headers && res.headers.get && res.headers.get('x-message-id')) ||
      `email_${Date.now()}`;
    return receipt({ to, from, subject, mode: 'live', provider: 'sendgrid', messageId });
  },
};

function receipt({ to, from, subject, mode, provider, messageId }) {
  return {
    channel: 'email',
    to,
    from,
    subject,
    mode,
    ...(provider ? { provider } : {}),
    messageId: messageId || `email_${Date.now()}`,
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

module.exports = emailPlugin;
