const smsPlugin = {
  name: 'sms',
  config: {},

  init(config) {
    this.config = config || {};
  },

  send: async function ({ to, message }, context) {
    if (!to) throw new Error('sms requires a "to" phone number');
    const from = this.config.from || '+15550000000';
    const mode = this.config.configured ? 'live' : 'mock';
    context.logger.info(`[SMS Plugin:${mode}] ${from} -> ${to}: ${message}`);
    // Replace this mock with a real gateway (Twilio) using this.config.
    await new Promise((res) => setTimeout(res, 200));
    return {
      channel: 'sms',
      to,
      from,
      mode,
      messageId: `sms_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = smsPlugin;
