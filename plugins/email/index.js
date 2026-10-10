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
    const mode = this.config.configured ? 'live' : 'mock';
    context.logger.info(
      `[Email Plugin:${mode}] ${from} -> ${to} ("${subject}"): ${message}`
    );
    // Replace this mock with a real provider (SES, SendGrid) using this.config.
    await new Promise((res) => setTimeout(res, 250));
    return {
      channel: 'email',
      to,
      from,
      subject,
      mode,
      messageId: `email_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = emailPlugin;
