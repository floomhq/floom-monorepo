'use strict';

const { sleep } = require('../util');

const DEFAULT_E2B_API_URL = 'https://api.e2b.app';
const TEMPLATE_TIMEOUT_MS = 5 * 60 * 1000;
const TEMPLATE_POLL_MS = 5 * 1000;

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

function assertId(label, id, response) {
  if (typeof id !== 'string' || !id || !/^[A-Za-z0-9_.:-]+$/.test(id)) {
    throw new Error(`${label} response did not include a valid id: ${JSON.stringify(response)}`);
  }
  return id;
}

function normalizeTemplate(json) {
  const templateId = assertId('e2b template', String(json.templateID || json.templateId || json.template_id || json.id || ''), json);
  const builds = Array.isArray(json.builds) ? json.builds : [];
  const buildID = String(json.buildID || json.buildId || json.build_id || '');
  const matchingBuild = buildID ? builds.find((build) => build && build.buildID === buildID) : null;
  const latestBuild = matchingBuild || builds[0] || {};
  return {
    templateId,
    buildID,
    status: String(json.status || json.buildStatus || json.build_status || json.state || latestBuild.status || ''),
  };
}

function isReadyStatus(status) {
  return ['ready', 'built'].includes(String(status || '').toLowerCase());
}

function isFailedStatus(status) {
  return ['error', 'failed', 'failure'].includes(String(status || '').toLowerCase());
}

function createE2BProvider({ token, baseUrl = process.env.FLOOM_BYO_E2B_API_URL || DEFAULT_E2B_API_URL } = {}) {
  async function e2bFetch(path, opts = {}) {
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'X-API-Key': token } : {}),
      ...(opts.headers || {}),
    };
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new Error(`${opts.label || 'e2b request'} failed: HTTP ${res.status} ${text}`);
    }
    return { json, text, res };
  }

  async function getTemplate(templateId) {
    const { json } = await e2bFetch(`/templates/${encodeURIComponent(templateId)}`, {
      method: 'GET',
      label: 'e2b get template',
    });
    return normalizeTemplate(json || {});
  }

  async function waitForTemplate(initial, options = {}) {
    if (!initial.status || isReadyStatus(initial.status)) return initial;
    let current = initial;
    const timeoutMs = options.timeoutMs || Number(process.env.FLOOM_BYO_E2B_TEMPLATE_TIMEOUT_MS || TEMPLATE_TIMEOUT_MS);
    const pollMs = options.pollMs || Number(process.env.FLOOM_BYO_E2B_TEMPLATE_POLL_MS || TEMPLATE_POLL_MS);
    const deadline = Date.now() + timeoutMs;
    while (!isReadyStatus(current.status)) {
      if (isFailedStatus(current.status)) {
        throw new Error(`e2b template ${current.templateId} build failed: ${JSON.stringify(current)}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`e2b template ${current.templateId} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      await sleep(pollMs);
      current = await getTemplate(current.templateId);
    }
    return current;
  }

  return {
    async createTemplate(image, options = {}) {
      const { json } = await e2bFetch('/v3/templates', {
        method: 'POST',
        body: { name: image },
        label: 'e2b create template',
      });
      const initial = normalizeTemplate(json || {});
      const finalTemplate = await waitForTemplate(initial, options);
      return { templateId: finalTemplate.templateId };
    },

    async spawn(templateId, inputs) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/templates/${encodeURIComponent(templateId)}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-API-Key': token } : {}),
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
        const runId = assertId('e2b run', String(json.runId || json.run_id || json.id || ''), json);
        return {
          runId,
          outputs: json.outputs !== undefined ? json.outputs : json.output,
        };
      }
      const parsed = parseStreamOutput(text);
      const runEvent = parsed.events.find((event) => event.runId || event.run_id || event.id);
      const runId = assertId('e2b run', String((runEvent && (runEvent.runId || runEvent.run_id || runEvent.id)) || ''), parsed.events);
      return {
        runId,
        outputs: parsed.outputs,
      };
    },

    async *streamLogs(runId) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/logs`, {
        method: 'GET',
        headers: token ? { 'X-API-Key': token } : {},
      });
      if (!res.ok) {
        throw new Error(`e2b stream logs failed: HTTP ${res.status} ${await res.text()}`);
      }
      const text = await res.text();
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        yield line;
      }
    },

    async kill(runId) {
      const { json } = await e2bFetch(`/runs/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
        label: 'e2b kill run',
      });
      return json || { ok: true };
    },

    async getQuota(account) {
      const suffix = account ? `?account=${encodeURIComponent(account)}` : '';
      const { json } = await e2bFetch(`/quota${suffix}`, {
        method: 'GET',
        label: 'e2b get quota',
      });
      return json;
    },
  };
}

module.exports = {
  createE2BProvider,
  parseStreamOutput,
};
