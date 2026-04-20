import { primaryButton } from './shared';
import type { DetectError } from './SourceInput';

export function PublishActions({
  error,
  slugSuggestions,
  onApplySlugSuggestion,
  onBack,
  onPublish,
  canPublish,
}: {
  error: DetectError;
  slugSuggestions: string[] | null;
  onApplySlugSuggestion: (next: string) => void;
  onBack: () => void;
  onPublish: () => void;
  canPublish: boolean;
}) {
  return (
    <>
      {error && (
        <div
          data-testid="build-error"
          style={{
            margin: '16px 0 0',
            padding: '10px 14px',
            background: '#fdecea',
            border: '1px solid #f4b7b1',
            color: '#c2321f',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 500 }}>{error.message}</div>
          {error.details && (
            <details
              data-testid="build-error-details"
              style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}
            >
              <summary style={{ cursor: 'pointer' }}>Technical details</summary>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'JetBrains Mono, monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {error.details}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Slug-taken recovery pills (audit 2026-04-20, Fix 2).
          Rendered only when the server returned 409 slug_taken.
          Clicking a pill writes the suggestion into the slug field
          and retries publish immediately. */}
      {slugSuggestions && slugSuggestions.length > 0 && (
        <div
          data-testid="build-slug-suggestions"
          style={{
            marginTop: 12,
            padding: '12px 14px',
            background: '#fff7ed',
            border: '1px solid #fcd9ae',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#7a4b19',
              marginBottom: 8,
              letterSpacing: '0.01em',
            }}
          >
            Try one of these:
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {slugSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onApplySlugSuggestion(suggestion)}
                data-testid={`build-slug-suggestion-${suggestion}`}
                style={{
                  padding: '6px 14px',
                  background: 'var(--card)',
                  border: '1px solid var(--accent, #10b981)',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent, #10b981)',
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 11.5,
              color: 'var(--muted)',
              lineHeight: 1.5,
            }}
          >
            Click a suggestion to publish with that slug, or edit the field above.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: '11px 18px',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onPublish}
          data-testid="build-publish"
          disabled={!canPublish}
          style={primaryButton(!canPublish)}
        >
          Publish
        </button>
      </div>
    </>
  );
}
