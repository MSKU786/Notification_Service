const slackPlugin = {
  name: 'slack',
  send: async (message, context) => {
    context.logger.info(`[Slack Plugin] Sending: ${message}`);
    // mock API call
    await new Promise((res) => setTimeout(res, 300));
    console.log('Message sent to Slack');
  },
};

module.exports = slackPlugin;
