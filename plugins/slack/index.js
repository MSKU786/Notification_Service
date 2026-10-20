const slackPlugin = {
  name: 'slack',
  config: {},

  init(config) {
    this.config = config || {};
  },

  send: async function ({ to, message, meta }, context) {
    const channel =
      to || (meta && meta.channel) || this.config.defaultChannel || '#general';

    // Slack has a single provider (the Web API); "live" simply means a token
    // is configured. Without one we mock so the service runs with no creds.
    const live = Boolean(this.config.configured);
    if (!live) {
      context.logger.info(`[Slack Plugin:mock] Sending to ${channel}: ${message}`);
      await new Promise((res) => setTimeout(res, 300));
      return receipt({ to: channel, mode: 'mock' });
    }

    return this._sendViaWebApi({ channel, message }, context);
  },

  // Slack chat.postMessage. Note: a transport-level 200 can still carry an
  // application error ({ ok: false, error }), so both must be checked.
  async _sendViaWebApi({ channel, message }, context) {
    const doFetch = (context && context.fetch) || globalThis.fetch;
    context.logger.info(`[Slack Plugin:live] Sending to ${channel}: ${message}`);
    const res = await doFetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: message }),
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`slack responded ${res.status}: ${body}`);
    }
    const json = await res.json();
    if (!json.ok) {
      throw new Error(`slack API error: ${json.error || 'unknown'}`);
    }
    return receipt({
      to: json.channel || channel,
      mode: 'live',
      messageId: json.ts || `slack_${Date.now()}`,
    });
  },
};

function receipt({ to, mode, messageId }) {
  return {
    channel: 'slack',
    to,
    mode,
    messageId: messageId || `slack_${Date.now()}`,
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

module.exports = slackPlugin;
