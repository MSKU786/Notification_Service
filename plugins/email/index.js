const emailPlugin = {
  name: 'email',
  send: async (message, context) => {
    context.logger.info(`[Email Plugin] Sending email: ${message}`);
    // Replace this mock with a real email provider integration (SendGrid, SES, etc.)
    await new Promise((res) => setTimeout(res, 250));
    context.logger.info('[Email Plugin] Sent');
  },
};

module.exports = emailPlugin;
