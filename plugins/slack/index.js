const slackPlugin = {
  name: 'slack',
  send: async ({ to, message, meta }, context) => {
    const channel = to || (meta && meta.channel) || '#general';
    context.logger.info(`[Slack Plugin] Sending to ${channel}: ${message}`);
    // mock API call
    await new Promise((res) => setTimeout(res, 300));
    return {
      channel: 'slack',
      to: channel,
      messageId: `slack_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = slackPlugin;
