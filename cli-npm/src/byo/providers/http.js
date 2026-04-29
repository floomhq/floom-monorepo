'use strict';

async function providerFetch(baseUrl, path, token, opts = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    const err = new Error(`${opts.label || 'provider request'} failed: HTTP ${res.status} ${text}`);
    err.status = res.status;
    err.body = text;
    err.json = json;
    throw err;
  }
  return { res, text, json };
}

function normalizeUrl(value) {
  if (!value) return '';
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

module.exports = {
  normalizeUrl,
  providerFetch,
};
