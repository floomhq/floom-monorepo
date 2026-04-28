import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function toIPv4Number(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = (out << 8) + n;
  }
  return out >>> 0;
}

function ipv4InRange(ip, base, maskBits) {
  const value = toIPv4Number(ip);
  const baseValue = toIPv4Number(base);
  if (value === null || baseValue === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isBlockedIp(ip) {
  if (net.isIP(ip) === 4) {
    return (
      ipv4InRange(ip, '0.0.0.0', 8) ||
      ipv4InRange(ip, '10.0.0.0', 8) ||
      ipv4InRange(ip, '127.0.0.0', 8) ||
      ipv4InRange(ip, '169.254.0.0', 16) ||
      ipv4InRange(ip, '172.16.0.0', 12) ||
      ipv4InRange(ip, '192.168.0.0', 16)
    );
  }

  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  }

  return false;
}

function blockedError(value) {
  return new Error(`ssrf_blocked: ${value}`);
}

async function resolveHost(hostname, lookup) {
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    return [{ address: hostname, family: literalFamily }];
  }
  return lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicUrl(rawUrl, lookup) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('invalid_url');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('invalid_url_scheme');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('invalid_url_host');
  if (host.toLowerCase() === 'localhost') throw blockedError(host);

  const records = await resolveHost(host, lookup);
  if (!records.length) throw new Error('dns_resolution_failed');

  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw blockedError(record.address);
    }
  }

  return parsed;
}

async function readLimitedBody(response, maxBodyBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBodyBytes) throw new Error('response_too_large');
    return buf;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('response_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function copyHeaders(headers) {
  const out = new Headers();
  for (const [key, value] of headers.entries()) out.set(key, value);
  return out;
}

export async function safeFetch(url, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    fetchImpl = globalThis.fetch,
    lookup = dns.lookup,
    signal,
    ...fetchOptions
  } = opts;

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }

  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = await assertPublicUrl(current, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortListener = () => controller.abort();
    signal?.addEventListener?.('abort', abortListener, { once: true });

    try {
      const response = await fetchImpl(parsed.toString(), {
        ...fetchOptions,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          current = new URL(location, parsed).toString();
          continue;
        }
      }

      const body = await readLimitedBody(response, maxBodyBytes);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: copyHeaders(response.headers),
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortListener);
    }
  }

  throw new Error('too_many_redirects');
}

export { isBlockedIp };
