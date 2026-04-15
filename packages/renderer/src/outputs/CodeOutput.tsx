import React from 'react';
import type { RenderProps } from '../contract/index.js';

/**
 * Syntax-highlighted code block. Uses `shiki` when available at runtime
 * (async, so we render an un-highlighted `<pre>` initially and upgrade on
 * mount). Falls back permanently to plain `<pre>` if shiki is not installed.
 * The language is read from `schema['x-floom-language']` or defaults to
 * `text`.
 */
export function CodeOutput({ data, schema, loading }: RenderProps): React.ReactElement {
  const language =
    (schema && (schema as Record<string, unknown>)['x-floom-language']) || 'text';
  const source =
    typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const [html, setHtml] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Optional peer dep — safe to fail silently.
        // @ts-expect-error runtime optional
        const shiki = await import('shiki');
        const highlighter = await shiki.createHighlighter({
          themes: ['github-light'],
          langs: [String(language)],
        });
        const highlighted = highlighter.codeToHtml(source, {
          lang: String(language),
          theme: 'github-light',
        });
        if (!cancelled) setHtml(highlighted);
      } catch {
        // shiki not installed or failed to load — stay on the plain pre.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, language]);

  if (loading) return <div className="floom-output floom-output-code loading">…</div>;

  if (html) {
    return (
      <div
        className="floom-output floom-output-code"
        data-lang={String(language)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre
      className="floom-output floom-output-code"
      data-lang={String(language)}
      style={{
        fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
        fontSize: 12,
        margin: 0,
      }}
    >
      {source}
    </pre>
  );
}
