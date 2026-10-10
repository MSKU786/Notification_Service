const slackPlugin = {
  name: 'slack',
  config: {},

  init(config) {
    this.config = config || {};
  },

  send: async function ({ to, message, meta }, context) {
    const channel =
      to || (meta && meta.channel) || this.config.defaultChannel || '#general';
    const mode = this.config.configured ? 'live' : 'mock';
    context.logger.info(
      `[Slack Plugin:${mode}] Sending to ${channel}: ${message}`
    );
    // mock API call — a real send would POST to Slack using this.config.token
    await new Promise((res) => setTimeout(res, 300));
    return {
      channel: 'slack',
      to: channel,
      mode,
      messageId: `slack_${Date.now()}`,
      deliveredAt: new Date().toISOString(),
    };
  },
};

module.exports = slackPlugin;
