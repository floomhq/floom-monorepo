'use strict';

const { providerFetch } = require('./http');

const DEFAULT_E2B_API_URL = 'https://api.e2b.dev';

function parseStreamOutput(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ type: 'log', data: line });
    }
  }
  const lastOutput = [...events].reverse().find((event) => event.outputs !== undefined || event.output !== undefined);
  return {
    events,
    outputs: lastOutput ? (lastOutput.outputs !== undefined ? lastOutput.outputs : lastOutput.output) : null,
  };
}

function createE2BProvider({ token, baseUrl = process.env.FLOOM_BYO_E2B_API_URL || DEFAULT_E2B_API_URL } = {}) {
  return {
    async createTemplate(image) {
      const { json } = await providerFetch(baseUrl, '/templates', token, {
        method: 'POST',
        body: { image },
        label: 'e2b create template',
      });
      return { templateId: String(json.templateId || json.template_id || json.id) };
    },

    async spawn(templateId, inputs) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/templates/${encodeURIComponent(templateId)}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ inputs }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`e2b spawn failed: HTTP ${res.status} ${text}`);
      }
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (json) {
        return {
          runId: String(json.runId || json.run_id || json.id),
          outputs: json.outputs !== undefined ? json.outputs : json.output,
        };
      }
      const parsed = parseStreamOutput(text);
      const runEvent = parsed.events.find((event) => event.runId || event.run_id || event.id);
      return {
        runId: String((runEvent && (runEvent.runId || runEvent.run_id || runEvent.id)) || ''),
        outputs: parsed.outputs,
      };
    },
  };
}

module.exports = {
  createE2BProvider,
  parseStreamOutput,
};
