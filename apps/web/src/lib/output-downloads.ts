/**
 * Download helpers for OutputPanel. Kept as plain functions so they can be
 * unit-tested without mounting React.
 */

export function downloadBlob(
  data: string | Blob,
  filename: string,
  mime: string,
): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  let raw = base64;
  const dataMatch = base64.match(/^data:([^;]+);base64,(.*)$/);
  if (dataMatch) {
    mime = dataMatch[1];
    raw = dataMatch[2];
  }
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else {
    try { s = JSON.stringify(value); } catch { s = String(value); }
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  const header = cols.map(csvCell).join(',');
  const body = rows.map((row) => cols.map((c) => csvCell(row[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export function markdownToHtml(md: string): string {
  if (!md) return '';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const codeBlocks: string[] = [];
  let src = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const langClass = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langClass}>${escape(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000CODEBLOCK_${idx}\u0000`;
  });

  src = escape(src);

  const inline = (s: string): string =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\u0000CODEBLOCK_\d+\u0000$/.test(line.trim())) { out.push(line.trim()); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (/^(?:>|&gt;)\s?/.test(line)) {
      const ql: string[] = [];
      while (i < lines.length && /^(?:>|&gt;)\s?/.test(lines[i])) { ql.push(lines[i].replace(/^(?:>|&gt;)\s?/, '')); i++; }
      out.push(`<blockquote><p>${inline(ql.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`); i++; }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`); i++; }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '') {
      const next = lines[i];
      if (/^(#{1,6})\s+/.test(next) || /^[-*+]\s+/.test(next) || /^\d+\.\s+/.test(next) || /^(?:>|&gt;)\s?/.test(next) || /^\u0000CODEBLOCK_\d+\u0000$/.test(next.trim())) break;
      paraLines.push(next); i++;
    }
    out.push(`<p>${inline(paraLines.join(' '))}</p>`);
  }

  return out.join('\n').replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_m, idx) => codeBlocks[Number(idx)] || '');
}

export function wrapHtmlDocument(bodyHtml: string, title = 'Output'): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title.replace(/</g, '&lt;')}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin-top: 1.5em; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
  p { margin: 0.75em 0; }
  code { background: #f4f4f5; padding: 0.15em 0.3em; border-radius: 4px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #f4f4f5; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 3px solid #d4d4d8; padding-left: 1em; color: #52525b; margin: 1em 0; }
  a { color: #2563eb; }
  ul, ol { padding-left: 1.5em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e4e4e7; padding: 0.5em; text-align: left; }
  th { background: #f4f4f5; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open(); doc.write(html); doc.close();
  const win = iframe.contentWindow;
  if (!win) { document.body.removeChild(iframe); return; }
  win.focus();
  setTimeout(() => {
    try { win.print(); } catch { /* ignore */ }
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1500);
  }, 200);
}

export type FileOutputValue =
  | string
  | { filename?: string; content_type?: string; base64?: string; size?: number };

export function resolveFileOutput(
  value: FileOutputValue,
  fallbackName: string,
): { filename: string; mime: string; base64: string; size: number | null } {
  if (typeof value === 'string') {
    return { filename: `${fallbackName}.bin`, mime: 'application/octet-stream', base64: value, size: null };
  }
  return {
    filename: value.filename || `${fallbackName}.bin`,
    mime: value.content_type || 'application/octet-stream',
    base64: value.base64 || '',
    size: typeof value.size === 'number' ? value.size : null,
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
