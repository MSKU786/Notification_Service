const smsPlugin = {
  name: 'sms',
  send: async ({ to, message }, context) => {
    if (!to) throw new Error('sms requires a "to" phone number');
    context.logger.info(`[SMS Plugin] Sending to ${to}: ${message}`);
    // Replace this mock with a real SMS gateway integration (Twilio, etc.)
    await new Promise((res) => setTimeout(res, 200));
    return {
      channel: 'sms',
      to,
      messageId: `sms_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = smsPlugin;
