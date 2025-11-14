const smsPlugin = {
  name: 'sms',
  send: async (message, context) => {
    context.logger.info(`[SMS Plugin] Sending SMS: ${message}`);
    // Replace this mock with a real SMS gateway integration (Twilio, etc.)
    await new Promise((res) => setTimeout(res, 200));
    context.logger.info('[SMS Plugin] Sent');
  },
};

module.exports = smsPlugin;
