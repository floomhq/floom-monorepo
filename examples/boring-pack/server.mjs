#!/usr/bin/env node
// Boring Pack — business utility apps bundled as a single proxied-mode sidecar.
//
// Single Node process, zero external dependencies. Serves one OpenAPI 3.0
// spec per app at /openapi/<slug>.json plus POST /<slug>/run per app.
// Every response is JSON and every handler completes well under 500ms.
//
// Registered at boot via examples/boring-pack/apps.yaml. Each entry is a
// proxied row in the apps table with base_url = http://127.0.0.1:4220.
//
// Apps bundled:
//   receipt           POST /receipt/run          printable A6 receipt, integer-cents math
//   vcard             POST /vcard/run             RFC 6350 v3.0 vCard string + data URL
//   ics               POST /ics/run               RFC 5545 calendar event + data URL
//   iban-validate     POST /iban-validate/run     IBAN mod-97-10 validation + decomposition
//   cover-letter-format POST /cover-letter-format/run  deterministic cover letter templates
//
// Run: node examples/boring-pack/server.mjs
// Env: BORING_PACK_PORT=4220 (default)

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.BORING_PACK_PORT || 4220);
const HOST = process.env.BORING_PACK_HOST || '127.0.0.1';
const PUBLIC_BASE =
  process.env.BORING_PACK_PUBLIC_BASE || `http://${HOST}:${PORT}`;

// ---------- shared helpers ----------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_048_576) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json_body'));
      }
    });
    req.on('error', reject);
  });
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.statusCode = status;
  err.code = code || 'bad_request';
  return err;
}

// Format integer cents as a display string using Intl.NumberFormat.
// currency: ISO 4217 code. locale: BCP 47 (default en-US).
function formatCents(cents, currency, locale = 'en-US') {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    // Fallback if currency code is unknown to Intl (still valid ISO 4217)
    return `${(major).toFixed(2)} ${currency}`;
  }
}

// ---------- receipt handler ----------

function handleReceipt(body) {
  if (typeof body.vendor !== 'string' || !body.vendor.trim()) {
    throw httpError(400, 'vendor must be a non-empty string');
  }
  if (typeof body.date !== 'string' || !body.date.trim()) {
    throw httpError(400, 'date must be a non-empty string');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw httpError(400, 'items must be a non-empty array');
  }
  const currency = (body.currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw httpError(400, 'currency must be a valid ISO 4217 code (3 uppercase letters)');
  }
  const payment_method = typeof body.payment_method === 'string' ? body.payment_method.trim() : 'Cash';

  // Parse line items — all arithmetic in integer cents.
  let subtotal_cents = 0;
  let tax_cents = 0;

  const parsedItems = body.items.map((item, i) => {
    if (typeof item.description !== 'string' || !item.description.trim()) {
      throw httpError(400, `items[${i}].description must be a non-empty string`);
    }
    const qty = Number(item.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) {
      throw httpError(400, `items[${i}].qty must be a positive integer (1–9999)`);
    }
    const unit_price_cents = Number(item.unit_price_cents);
    if (!Number.isInteger(unit_price_cents) || unit_price_cents < 0) {
      throw httpError(400, `items[${i}].unit_price_cents must be a non-negative integer`);
    }
    const tax_pct = Number(item.tax_pct ?? 0);
    if (!Number.isFinite(tax_pct) || tax_pct < 0 || tax_pct > 100) {
      throw httpError(400, `items[${i}].tax_pct must be a number between 0 and 100`);
    }

    const line_subtotal_cents = qty * unit_price_cents;
    // Integer-cents tax: round half-up per line item.
    const line_tax_cents = Math.round(line_subtotal_cents * (tax_pct / 100));
    const line_total_cents = line_subtotal_cents + line_tax_cents;

    subtotal_cents += line_subtotal_cents;
    tax_cents += line_tax_cents;

    return {
      description: item.description.trim(),
      qty,
      unit_price_cents,
      tax_pct,
      line_subtotal_cents,
      line_tax_cents,
      line_total_cents,
      unit_price_fmt: formatCents(unit_price_cents, currency),
      line_total_fmt: formatCents(line_total_cents, currency),
    };
  });

  const total_cents = subtotal_cents + tax_cents;
  const vendor = body.vendor.trim();
  const customer = typeof body.customer === 'string' ? body.customer.trim() : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
  const date = body.date.trim();

  const subtotal_fmt = formatCents(subtotal_cents, currency);
  const tax_fmt = formatCents(tax_cents, currency);
  const total_fmt = formatCents(total_cents, currency);

  // Build printable A6 HTML receipt (148x105mm equivalent in px at 96dpi).
  const itemRows = parsedItems.map((it) =>
    `<tr>
      <td class="desc">${escHtml(it.description)}</td>
      <td class="num">${it.qty}&times;${escHtml(it.unit_price_fmt)}</td>
      <td class="num">${escHtml(it.line_total_fmt)}</td>
    </tr>`
  ).join('\n');

  const receipt_html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:monospace;font-size:11px;width:148mm;min-height:105mm;padding:6mm;color:#111;background:#fff}
  h1{font-size:13px;font-weight:bold;text-align:center;margin-bottom:4px}
  .meta{text-align:center;font-size:10px;color:#555;margin-bottom:6px}
  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  th{border-bottom:1px solid #111;padding:2px 0;text-align:left;font-size:10px}
  th.num{text-align:right}
  td{padding:2px 0;vertical-align:top}
  td.num{text-align:right;white-space:nowrap}
  td.desc{word-break:break-word}
  .divider{border-top:1px dashed #aaa;margin:4px 0}
  .totals{width:100%;border-collapse:collapse}
  .totals td{padding:1px 0}
  .totals td.lbl{color:#555}
  .totals td.val{text-align:right;white-space:nowrap}
  .totals tr.grand td{font-weight:bold;border-top:1px solid #111;padding-top:3px}
  .footer{text-align:center;font-size:9px;color:#888;margin-top:6px}
</style>
</head>
<body>
<h1>${escHtml(vendor)}</h1>
<div class="meta">${escHtml(date)}${customer ? ' &mdash; ' + escHtml(customer) : ''}</div>
<table>
  <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div class="divider"></div>
<table class="totals">
  <tr><td class="lbl">Subtotal</td><td class="val">${escHtml(subtotal_fmt)}</td></tr>
  <tr><td class="lbl">Tax</td><td class="val">${escHtml(tax_fmt)}</td></tr>
  <tr class="grand"><td class="lbl">Total</td><td class="val">${escHtml(total_fmt)}</td></tr>
  <tr><td class="lbl">Payment</td><td class="val">${escHtml(payment_method)}</td></tr>
</table>
${notes ? `<div class="divider"></div><div class="footer">${escHtml(notes)}</div>` : ''}
<div class="footer">Thank you</div>
</body>
</html>`;

  return {
    vendor,
    customer,
    date,
    payment_method,
    currency,
    subtotal_cents,
    tax_cents,
    total_cents,
    subtotal_fmt,
    tax_fmt,
    total_fmt,
    items: parsedItems,
    receipt_html,
    notes,
  };
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- vcard handler ----------

function handleVcard(body) {
  if (typeof body.full_name !== 'string' || !body.full_name.trim()) {
    throw httpError(400, 'full_name must be a non-empty string');
  }

  const full_name = body.full_name.trim();
  const title = typeof body.title === 'string' ? body.title.trim() : null;
  const org = typeof body.org === 'string' ? body.org.trim() : null;
  const email = typeof body.email === 'string' ? body.email.trim() : null;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
  const website = typeof body.website === 'string' ? body.website.trim() : null;
  const address = typeof body.address === 'string' ? body.address.trim() : null;
  const photo_url = typeof body.photo_url === 'string' ? body.photo_url.trim() : null;

  // Validate email format loosely
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'email does not look like a valid email address');
  }
  // Validate website loosely
  if (website) {
    try {
      new URL(website);
    } catch {
      throw httpError(400, 'website must be a valid absolute URL');
    }
  }

  // Build RFC 6350 v3.0 vCard.
  // Lines longer than 75 octets MUST be folded per RFC 6350 §3.2.
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    vcfLine('FN', full_name),
    vcfLine('N', vcfN(full_name)),
  ];
  if (org) lines.push(vcfLine('ORG', org));
  if (title) lines.push(vcfLine('TITLE', title));
  if (email) lines.push(vcfLine('EMAIL;TYPE=INTERNET', email));
  if (phone) lines.push(vcfLine('TEL;TYPE=VOICE', phone));
  if (website) lines.push(vcfLine('URL', website));
  if (address) lines.push(vcfLine('ADR;TYPE=WORK', vcfAdr(address)));
  if (photo_url) lines.push(vcfLine('PHOTO;VALUE=URI', photo_url));
  lines.push('END:VCARD');

  const vcard_string = lines.join('\r\n') + '\r\n';

  // data: URL per RFC 2397 — charset is utf-8
  const data_url = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard_string)}`;

  // Derive a safe filename from the name
  const safe_name = full_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const filename = `${safe_name || 'contact'}.vcf`;

  return {
    full_name,
    title,
    org,
    email,
    phone,
    website,
    address,
    vcard_string,
    data_url,
    filename,
  };
}

// Escape vCard value per RFC 6350 §3.4.
function vcfEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Build N: component (Last;First;Middle;Prefix;Suffix). Simple heuristic.
function vcfN(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return `${vcfEscape(parts[0])};;;;`;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${vcfEscape(last)};${vcfEscape(first)};;;`;
}

// Build ADR value from a freeform address string (put it in street-address slot).
function vcfAdr(address) {
  // ADR: PO-Box;Extended;Street;City;Region;PostalCode;Country
  const escaped = vcfEscape(address.replace(/\n/g, ' '));
  return `;;${escaped};;;;`;
}

// Fold long vCard lines to max 75 octets per RFC 6350 §3.2.
function vcfLine(property, value) {
  const line = `${property}:${vcfEscape(String(value))}`;
  if (Buffer.byteLength(line, 'utf-8') <= 75) return line;
  const octets = Buffer.from(line, 'utf-8');
  const result = [];
  let offset = 0;
  let first = true;
  while (offset < octets.length) {
    const maxBytes = first ? 75 : 74; // 1 byte for leading space on continuation
    let end = offset + maxBytes;
    // Don't split multi-byte UTF-8 sequences.
    while (end < octets.length && (octets[end] & 0xc0) === 0x80) end -= 1;
    result.push((first ? '' : ' ') + octets.subarray(offset, end).toString('utf-8'));
    offset = end;
    first = false;
  }
  return result.join('\r\n');
}

// ---------- ics handler ----------

function handleIcs(body) {
  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw httpError(400, 'title must be a non-empty string');
  }
  if (typeof body.start !== 'string' || !body.start.trim()) {
    throw httpError(400, 'start must be a non-empty ISO 8601 string');
  }

  const title = body.title.trim();
  const timezone = typeof body.timezone === 'string' && body.timezone.trim()
    ? body.timezone.trim()
    : 'UTC';
  const location = typeof body.location === 'string' ? body.location.trim() : null;
  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const organizer_email = typeof body.organizer_email === 'string' ? body.organizer_email.trim() : null;
  const attendees = Array.isArray(body.attendees)
    ? body.attendees.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim())
    : [];

  // Parse start datetime
  let startDate;
  try {
    startDate = new Date(body.start.trim());
    if (isNaN(startDate.getTime())) throw new Error('invalid date');
  } catch {
    throw httpError(400, 'start must be a valid ISO 8601 date/time string');
  }

  // Parse end
  let endDate;
  if (body.end) {
    try {
      endDate = new Date(String(body.end).trim());
      if (isNaN(endDate.getTime())) throw new Error('invalid date');
    } catch {
      throw httpError(400, 'end must be a valid ISO 8601 date/time string');
    }
    if (endDate <= startDate) {
      throw httpError(400, 'end must be after start');
    }
  } else {
    const durMin = Number(body.duration_minutes ?? 60);
    if (!Number.isInteger(durMin) || durMin < 1 || durMin > 10080) {
      throw httpError(400, 'duration_minutes must be an integer between 1 and 10080 (7 days)');
    }
    endDate = new Date(startDate.getTime() + durMin * 60_000);
  }

  // Stable UID: hash of (title + start ISO + organizer_email or empty)
  const uidSource = `${title}|${startDate.toISOString()}|${organizer_email || ''}`;
  const uid = createHash('sha256').update(uidSource, 'utf-8').digest('hex').slice(0, 32) + '@boring-pack.floom.dev';

  // Format dates as iCal YYYYMMDDTHHMMSSZ (UTC)
  function icsDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  }

  const dtStamp = icsDate(new Date());
  const dtStart = icsDate(startDate);
  const dtEnd = icsDate(endDate);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Floom Boring Pack//ICS Generator//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    icsTextLine('SUMMARY', title),
  ];

  if (timezone !== 'UTC') {
    lines.push(icsTextLine('X-WR-TIMEZONE', timezone));
  }
  if (location) lines.push(icsTextLine('LOCATION', location));
  if (description) lines.push(icsTextLine('DESCRIPTION', description));
  if (organizer_email) lines.push(`ORGANIZER;CN=${icsEscape(organizer_email)}:mailto:${organizer_email}`);
  for (const att of attendees) {
    lines.push(`ATTENDEE;RSVP=TRUE:mailto:${att}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  const ics_string = lines.join('\r\n') + '\r\n';

  const data_url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics_string)}`;

  // Safe filename from title
  const safe = title.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const filename = `${safe || 'event'}.ics`;

  return {
    title,
    start_iso: startDate.toISOString(),
    end_iso: endDate.toISOString(),
    timezone,
    uid,
    ics_string,
    data_url,
    filename,
  };
}

// Escape text fields per RFC 5545 §3.3.11.
function icsEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Fold iCal content lines to 75 octets per RFC 5545 §3.1.
function icsTextLine(property, value) {
  const line = `${property}:${icsEscape(value)}`;
  if (line.length <= 75) return line;
  const result = [];
  let offset = 0;
  while (offset < line.length) {
    const take = offset === 0 ? 75 : 74;
    result.push((offset === 0 ? '' : ' ') + line.slice(offset, offset + take));
    offset += take;
  }
  return result.join('\r\n');
}

// ---------- iban-validate handler ----------

// IBAN country length table (ISO 13616-1:2020 + common additions).
const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20,
  EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27,
  MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29,
  VA: 22, VG: 24, XK: 20,
};

// Human-readable country names for the country_code.
const COUNTRY_NAMES = {
  AD: 'Andorra', AE: 'United Arab Emirates', AL: 'Albania', AT: 'Austria',
  AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria',
  BH: 'Bahrain', BR: 'Brazil', BY: 'Belarus', CH: 'Switzerland', CR: 'Costa Rica',
  CY: 'Cyprus', CZ: 'Czech Republic', DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark',
  DO: 'Dominican Republic', EE: 'Estonia', EG: 'Egypt', ES: 'Spain', FI: 'Finland',
  FK: 'Falkland Islands', FO: 'Faroe Islands', FR: 'France', GB: 'United Kingdom',
  GE: 'Georgia', GI: 'Gibraltar', GL: 'Greenland', GR: 'Greece', GT: 'Guatemala',
  HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IL: 'Israel', IQ: 'Iraq', IS: 'Iceland',
  IT: 'Italy', JO: 'Jordan', KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon',
  LC: 'Saint Lucia', LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg',
  LV: 'Latvia', LY: 'Libya', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius',
  NL: 'Netherlands', NO: 'Norway', PK: 'Pakistan', PL: 'Poland', PS: 'Palestine',
  PT: 'Portugal', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia',
  SA: 'Saudi Arabia', SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SI: 'Slovenia',
  SK: 'Slovakia', SM: 'San Marino', SO: 'Somalia', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', TL: 'East Timor', TN: 'Tunisia', TR: 'Turkey', UA: 'Ukraine',
  VA: 'Vatican City', VG: 'British Virgin Islands', XK: 'Kosovo',
};

function handleIbanValidate(body) {
  if (typeof body.iban !== 'string' || !body.iban.trim()) {
    throw httpError(400, 'iban must be a non-empty string');
  }

  // Normalize: remove spaces, uppercase
  const raw = body.iban.trim().replace(/\s+/g, '').toUpperCase();

  // Basic format check: 2-letter country + 2-digit check + up to 30 alphanumeric
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(raw)) {
    return {
      valid: false,
      formatted: body.iban.trim(),
      country_code: null,
      country_name: null,
      bank_code: null,
      account_number: null,
      error: 'IBAN must start with two letters, two digits, then up to 30 alphanumeric characters.',
    };
  }

  const country_code = raw.slice(0, 2);
  const expectedLength = IBAN_LENGTHS[country_code];

  if (!expectedLength) {
    return {
      valid: false,
      formatted: formatIban(raw),
      country_code,
      country_name: null,
      bank_code: null,
      account_number: null,
      error: `Country code ${country_code} is not in the IBAN registry.`,
    };
  }

  if (raw.length !== expectedLength) {
    return {
      valid: false,
      formatted: formatIban(raw),
      country_code,
      country_name: COUNTRY_NAMES[country_code] || null,
      bank_code: null,
      account_number: null,
      error: `IBAN for ${country_code} must be exactly ${expectedLength} characters; got ${raw.length}.`,
    };
  }

  // mod-97-10 check per ISO 7064:
  // 1. Move first 4 chars to end.
  // 2. Replace each letter with digits (A=10, B=11, ..., Z=35).
  // 3. Compute mod 97; result must be 1.
  const rearranged = raw.slice(4) + raw.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const remainder = mod97(numeric);

  const valid = remainder === 1;
  const formatted = formatIban(raw);
  const country_name = COUNTRY_NAMES[country_code] || null;

  // Decompose BBAN (Basic Bank Account Number): chars after first 4.
  const bban = raw.slice(4);

  // Country-specific BBAN parsing (bank_code, account_number).
  const { bank_code, account_number } = parseBban(country_code, bban);

  return {
    valid,
    formatted,
    country_code,
    country_name,
    bank_code,
    account_number,
    error: valid ? null : 'IBAN checksum failed (mod-97-10 remainder is not 1).',
  };
}

// Format IBAN with a space every 4 characters.
function formatIban(iban) {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

// Big-number mod-97 via iterative chunking to avoid floating point overflow.
function mod97(numericString) {
  let remainder = 0;
  for (let i = 0; i < numericString.length; i += 7) {
    const chunk = String(remainder) + numericString.slice(i, i + 7);
    remainder = Number(chunk) % 97;
  }
  return remainder;
}

// Country-specific BBAN structure. Only a selection of common countries.
// Returns bank_code and account_number strings (or null if not parsed).
function parseBban(countryCode, bban) {
  const rules = {
    DE: { bank: [0, 8], account: [8, 18] },    // 8-digit BLZ + 10-digit Kontonummer
    AT: { bank: [0, 5], account: [5, 16] },    // 5-digit Bankleitzahl + 11-digit Kontonummer
    CH: { bank: [0, 5], account: [5, 17] },    // 5-digit clearing + 12-digit account
    GB: { bank: [4, 10], account: [10, 22] },  // Sort-code chars 4-10, account 10-22
    FR: { bank: [0, 5], account: [10, 21] },   // 5-digit bank + 5-digit branch (skipped) + 11-digit account
    NL: { bank: [0, 4], account: [4, 14] },    // 4-char bank + 10-digit account
    ES: { bank: [0, 4], account: [8, 20] },    // 4-digit bank + 4-digit branch (skip) + 2-check + 10-account
    IT: { bank: [1, 6], account: [11, 23] },   // 1 CIN + 5 ABI + 5 CAB + 12 account
    BE: { bank: [0, 3], account: [3, 12] },    // 3-digit bank + 7-digit + 2-check
    SE: { bank: [0, 3], account: [3, 17] },    // 3-digit clearing + rest
    NO: { bank: [0, 4], account: [4, 11] },    // 4-digit bank + 7-digit account
    DK: { bank: [0, 4], account: [4, 14] },    // 4-digit reg + 10-digit account
    PL: { bank: [0, 8], account: [8, 24] },    // 8-digit routing + 16-digit account
    CZ: { bank: [0, 4], account: [4, 20] },    // 4-digit bank + 16-digit account
  };
  const rule = rules[countryCode];
  if (!rule) return { bank_code: null, account_number: null };
  return {
    bank_code: bban.slice(rule.bank[0], rule.bank[1]) || null,
    account_number: bban.slice(rule.account[0], rule.account[1]) || null,
  };
}

// ---------- cover-letter-format handler ----------

const TONES = ['formal', 'warm', 'direct'];

const TEMPLATES = {
  formal: {
    short: (d) => `Dear Hiring Committee,

I am writing to express my interest in the ${d.role} position at ${d.company}. ${d.bullets[0]}. I would welcome the opportunity to contribute to your team.

Sincerely,
${d.applicant_name}`,
    medium: (d) => `Dear Hiring Committee,

I am writing to apply for the ${d.role} role at ${d.company}. My background aligns closely with your requirements.

${d.bullets.slice(0, 4).map((b) => `- ${b}`).join('\n')}

I am confident that my experience and commitment make me a strong candidate. I look forward to the opportunity to discuss further.

Sincerely,
${d.applicant_name}`,
    long: (d) => `Dear Hiring Committee,

I am writing to formally express my interest in the ${d.role} position at ${d.company}. Having researched your organization, I am convinced that my profile aligns well with your needs.

${d.bullets.map((b) => `- ${b}`).join('\n')}

I am committed to delivering results and would be honoured to bring my skills to ${d.company}. I welcome the opportunity to discuss how I can contribute to your goals.

Thank you for your consideration. I look forward to hearing from you.

Sincerely,
${d.applicant_name}`,
  },
  warm: {
    short: (d) => `Hi ${d.company} team,

I came across the ${d.role} opening and knew I had to apply. ${d.bullets[0]}. I would love to chat more.

${d.applicant_name}`,
    medium: (d) => `Hi ${d.company} team,

I was excited to see the ${d.role} opening and would love to be considered. A few things about me that I think are relevant:

${d.bullets.slice(0, 4).map((b) => `- ${b}`).join('\n')}

I am genuinely enthusiastic about what ${d.company} is building and would love to bring this energy to your team.

Looking forward to connecting,
${d.applicant_name}`,
    long: (d) => `Hi ${d.company} team,

I was genuinely excited when I saw the ${d.role} opening. I have been following ${d.company}'s work, and the role feels like a natural fit for where I am in my career.

Here is a quick picture of what I bring:

${d.bullets.map((b) => `- ${b}`).join('\n')}

I care deeply about the kind of work ${d.company} is doing, and I would bring that same energy to every project. If it sounds like a match, I would love to set up a call.

Thank you so much for reading this far,
${d.applicant_name}`,
  },
  direct: {
    short: (d) => `Applying for: ${d.role} at ${d.company}

${d.bullets[0]}. Let me know if you want to talk.

${d.applicant_name}`,
    medium: (d) => `Applying for: ${d.role} at ${d.company}

${d.bullets.slice(0, 4).map((b) => `- ${b}`).join('\n')}

Happy to jump on a call.
${d.applicant_name}`,
    long: (d) => `Applying for: ${d.role} at ${d.company}

${d.bullets.map((b) => `- ${b}`).join('\n')}

That is the quick version. Happy to go deeper on any of these points in a call.

${d.applicant_name}`,
  },
};

// Word count utility for length enforcement.
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function textToHtml(text) {
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${escHtml(para.replace(/\n/g, '<br/>'))}</p>`)
    .join('\n');
}

function handleCoverLetterFormat(body) {
  if (typeof body.applicant_name !== 'string' || !body.applicant_name.trim()) {
    throw httpError(400, 'applicant_name must be a non-empty string');
  }
  if (typeof body.role !== 'string' || !body.role.trim()) {
    throw httpError(400, 'role must be a non-empty string');
  }
  if (typeof body.company !== 'string' || !body.company.trim()) {
    throw httpError(400, 'company must be a non-empty string');
  }
  if (!Array.isArray(body.your_bullets) || body.your_bullets.length < 1) {
    throw httpError(400, 'your_bullets must be a non-empty array of strings');
  }
  if (body.your_bullets.length > 7) {
    throw httpError(400, 'your_bullets must have at most 7 items');
  }
  const bullets = body.your_bullets.map((b, i) => {
    if (typeof b !== 'string' || !b.trim()) {
      throw httpError(400, `your_bullets[${i}] must be a non-empty string`);
    }
    return b.trim();
  });

  const tone = TONES.includes(body.tone) ? body.tone : 'direct';
  const applicant_name = body.applicant_name.trim();
  const role = body.role.trim();
  const company = body.company.trim();

  const tmpl = TEMPLATES[tone];
  const d = { applicant_name, role, company, bullets };

  const short_text = tmpl.short(d);
  const medium_text = tmpl.medium(d);
  const long_text = tmpl.long(d);

  return {
    tone,
    applicant_name,
    role,
    company,
    variants: {
      short: {
        text: short_text,
        html: textToHtml(short_text),
        word_count: wordCount(short_text),
      },
      medium: {
        text: medium_text,
        html: textToHtml(medium_text),
        word_count: wordCount(medium_text),
      },
      long: {
        text: long_text,
        html: textToHtml(long_text),
        word_count: wordCount(long_text),
      },
    },
  };
}

// ---------- OpenAPI specs ----------

function buildSpec(slug, title, description, operationId, requestSchema, responseSchema, exampleInput) {
  return {
    openapi: '3.0.0',
    info: { title, version: '1.0.0', description },
    servers: [{ url: PUBLIC_BASE }],
    paths: {
      [`/${slug}/run`]: {
        post: {
          operationId,
          summary: title,
          description,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: requestSchema,
                example: exampleInput,
              },
            },
          },
          responses: {
            200: {
              description: 'Success',
              content: {
                'application/json': { schema: responseSchema },
              },
            },
            400: {
              description: 'Invalid input',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                      code: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

const SPECS = {
  receipt: buildSpec(
    'receipt',
    'Receipt Generator',
    'Generate a printable A6 receipt from line items. Integer-cents math for all totals; Intl.NumberFormat for display.',
    'generate',
    {
      type: 'object',
      required: ['vendor', 'date', 'items', 'payment_method', 'currency'],
      properties: {
        vendor: { type: 'string', description: 'Merchant or seller name.' },
        customer: { type: 'string', description: 'Optional customer name.' },
        date: { type: 'string', description: 'Receipt date, for example 2026-04-28.' },
        items: {
          type: 'array',
          minItems: 1,
          description: 'Line items.',
          items: {
            type: 'object',
            required: ['description', 'unit_price_cents'],
            properties: {
              description: { type: 'string' },
              qty: { type: 'integer', minimum: 1, default: 1 },
              unit_price_cents: { type: 'integer', minimum: 0, description: 'Price in cents (integer). 1000 = 10.00.' },
              tax_pct: { type: 'number', minimum: 0, maximum: 100, default: 0, description: 'Tax percentage, for example 19.0.' },
            },
          },
        },
        payment_method: { type: 'string', description: 'For example: Card, Cash, Bank transfer.' },
        currency: { type: 'string', description: 'ISO 4217 code, for example USD, EUR, GBP.' },
        notes: { type: 'string', description: 'Optional note printed at the bottom.' },
      },
    },
    {
      type: 'object',
      properties: {
        vendor: { type: 'string' },
        customer: { type: 'string' },
        date: { type: 'string' },
        payment_method: { type: 'string' },
        currency: { type: 'string' },
        subtotal_cents: { type: 'integer' },
        tax_cents: { type: 'integer' },
        total_cents: { type: 'integer' },
        subtotal_fmt: { type: 'string' },
        tax_fmt: { type: 'string' },
        total_fmt: { type: 'string' },
        items: { type: 'array', items: { type: 'object' } },
        receipt_html: { type: 'string', description: 'Printable A6 HTML.' },
        notes: { type: 'string' },
      },
    },
    {
      vendor: 'Floom Coffee',
      customer: 'Federico',
      date: '2026-04-28',
      items: [
        { description: 'Espresso', qty: 2, unit_price_cents: 350, tax_pct: 7 },
        { description: 'Croissant', qty: 1, unit_price_cents: 275, tax_pct: 7 },
      ],
      payment_method: 'Card',
      currency: 'EUR',
      notes: 'Thank you for visiting.',
    },
  ),

  vcard: buildSpec(
    'vcard',
    'vCard Generator',
    'Generate an RFC 6350 v3.0 vCard string and data URL from contact fields. No external calls.',
    'generate',
    {
      type: 'object',
      required: ['full_name'],
      properties: {
        full_name: { type: 'string', description: 'Full name of the contact.' },
        title: { type: 'string', description: 'Job title.' },
        org: { type: 'string', description: 'Organisation name.' },
        email: { type: 'string', description: 'Email address.' },
        phone: { type: 'string', description: 'Phone number in any format.' },
        website: { type: 'string', description: 'Absolute URL.' },
        address: { type: 'string', description: 'Postal address (freeform).' },
        photo_url: { type: 'string', description: 'Absolute URL to a photo.' },
      },
    },
    {
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        title: { type: 'string' },
        org: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        website: { type: 'string' },
        address: { type: 'string' },
        vcard_string: { type: 'string', description: 'RFC 6350 vCard content.' },
        data_url: { type: 'string', description: 'data:text/vcard;charset=utf-8,... URL.' },
        filename: { type: 'string', description: 'Suggested filename for download.' },
      },
    },
    {
      full_name: 'Federico de Ponte',
      title: 'Founder',
      org: 'Floom',
      email: 'fede@floom.dev',
      phone: '+49 160 123 4567',
      website: 'https://floom.dev',
    },
  ),

  ics: buildSpec(
    'ics',
    'Calendar Event (ICS)',
    'Generate an RFC 5545 .ics calendar event string and data URL. Stable UID derived from title + start time.',
    'generate',
    {
      type: 'object',
      required: ['title', 'start'],
      properties: {
        title: { type: 'string', description: 'Event title / summary.' },
        start: { type: 'string', description: 'Start date/time in ISO 8601.' },
        end: { type: 'string', description: 'End date/time in ISO 8601. Provide end or duration_minutes.' },
        duration_minutes: { type: 'integer', minimum: 1, maximum: 10080, default: 60, description: 'Duration in minutes if end is not provided.' },
        timezone: { type: 'string', default: 'UTC', description: 'IANA timezone name, for example Europe/Berlin.' },
        location: { type: 'string', description: 'Location string.' },
        description: { type: 'string', description: 'Event description.' },
        organizer_email: { type: 'string', description: 'Organizer email address.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses.' },
      },
    },
    {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_iso: { type: 'string' },
        end_iso: { type: 'string' },
        timezone: { type: 'string' },
        uid: { type: 'string' },
        ics_string: { type: 'string' },
        data_url: { type: 'string' },
        filename: { type: 'string' },
      },
    },
    {
      title: 'Floom Launch Call',
      start: '2026-05-01T14:00:00Z',
      duration_minutes: 60,
      timezone: 'Europe/Berlin',
      location: 'https://meet.floom.dev/launch',
      organizer_email: 'fede@floom.dev',
      attendees: ['team@floom.dev'],
    },
  ),

  'iban-validate': buildSpec(
    'iban-validate',
    'IBAN Validator',
    'Validate an IBAN using the standard mod-97-10 checksum. Returns country, bank code, account number, and a formatted string.',
    'validate',
    {
      type: 'object',
      required: ['iban'],
      properties: {
        iban: { type: 'string', description: 'IBAN string to validate. Spaces are accepted and stripped.' },
      },
    },
    {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        formatted: { type: 'string', description: 'IBAN with spaces every 4 characters.' },
        country_code: { type: 'string' },
        country_name: { type: 'string' },
        bank_code: { type: 'string' },
        account_number: { type: 'string' },
        error: { type: 'string', description: 'Error message when valid is false.' },
      },
    },
    { iban: 'DE89370400440532013000' },
  ),

  'cover-letter-format': buildSpec(
    'cover-letter-format',
    'Cover Letter Formatter',
    'Generate three length variants of a cover letter (short, medium, long) from structured bullets. Deterministic templates, no AI.',
    'format',
    {
      type: 'object',
      required: ['applicant_name', 'role', 'company', 'your_bullets'],
      properties: {
        applicant_name: { type: 'string', description: 'Your full name.' },
        role: { type: 'string', description: 'Role you are applying for.' },
        company: { type: 'string', description: 'Company name.' },
        your_bullets: {
          type: 'array',
          minItems: 1,
          maxItems: 7,
          items: { type: 'string' },
          description: '3 to 7 bullet points about your background relevant to this role.',
        },
        tone: {
          type: 'string',
          enum: ['formal', 'warm', 'direct'],
          default: 'direct',
          description: 'Writing tone. formal = traditional, warm = friendly, direct = concise.',
        },
      },
    },
    {
      type: 'object',
      properties: {
        tone: { type: 'string' },
        applicant_name: { type: 'string' },
        role: { type: 'string' },
        company: { type: 'string' },
        variants: {
          type: 'object',
          properties: {
            short: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                html: { type: 'string' },
                word_count: { type: 'integer' },
              },
            },
            medium: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                html: { type: 'string' },
                word_count: { type: 'integer' },
              },
            },
            long: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                html: { type: 'string' },
                word_count: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    {
      applicant_name: 'Federico de Ponte',
      role: 'Technical Projects Lead',
      company: 'Floom',
      your_bullets: [
        'Built and shipped AI apps reaching 300K+ LinkedIn impressions',
        'Technical founder with 50B+ AI coding tokens across production systems',
        'Left SCAILE at $600K ARR to build Floom full-time',
      ],
      tone: 'direct',
    },
  ),
};

// ---------- routing table ----------

const HANDLERS = {
  receipt: handleReceipt,
  vcard: handleVcard,
  ics: handleIcs,
  'iban-validate': handleIbanValidate,
  'cover-letter-format': handleCoverLetterFormat,
};

// ---------- HTTP server ----------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', PUBLIC_BASE);
    const pathname = url.pathname;

    // Health probe.
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'boring-pack',
        apps: Object.keys(SPECS),
      });
    }

    // OpenAPI spec per slug.
    if (req.method === 'GET' && pathname.startsWith('/openapi/')) {
      const slug = pathname.slice('/openapi/'.length).replace(/\.json$/, '');
      const spec = SPECS[slug];
      if (!spec) {
        return sendJson(res, 404, { error: 'unknown_app', slug });
      }
      return sendJson(res, 200, spec);
    }

    // Per-app run endpoint.
    const match = pathname.match(/^\/([a-z0-9-]+)\/run$/);
    if (req.method === 'POST' && match) {
      const slug = match[1];
      const handler = HANDLERS[slug];
      if (!handler) {
        return sendJson(res, 404, { error: 'unknown_app', slug });
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          error: err.message || 'invalid_body',
          code: 'invalid_body',
        });
      }
      try {
        const result = handler(body);
        return sendJson(res, 200, result);
      } catch (err) {
        if (err.statusCode) {
          return sendJson(res, err.statusCode, {
            error: err.message,
            code: err.code || 'bad_request',
          });
        }
        console.error(`[boring-pack] ${slug} handler crashed:`, err);
        return sendJson(res, 500, {
          error: 'internal_error',
          code: 'internal_error',
        });
      }
    }

    sendJson(res, 404, { error: 'not_found', path: pathname });
  } catch (err) {
    console.error('[boring-pack] request failed:', err);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[boring-pack] listening on ${PUBLIC_BASE}`);
  console.log(`[boring-pack] apps: ${Object.keys(SPECS).join(', ')}`);
});

// Clean shutdown so parent process can stop us without orphans.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
