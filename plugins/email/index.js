const emailPlugin = {
  name: 'email',
  send: async ({ to, message, meta }, context) => {
    if (!to) throw new Error('email requires a "to" address');
    const subject = (meta && meta.subject) || 'Notification';
    context.logger.info(`[Email Plugin] Sending to ${to} ("${subject}"): ${message}`);
    // Replace this mock with a real email provider integration (SendGrid, SES, etc.)
    await new Promise((res) => setTimeout(res, 250));
    return {
      channel: 'email',
      to,
      subject,
      messageId: `email_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = emailPlugin;
