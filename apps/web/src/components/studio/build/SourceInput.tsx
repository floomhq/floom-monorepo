import { DockerIcon, ErrorCard, FileIcon, GithubIcon, RampCard, primaryButton } from './shared';

export type GithubDetectAttempt = { attemptedUrls: string[] } | null;

export type DetectError = { message: string; details?: string } | null;

export type GithubErrorKind = 'private' | 'no-openapi' | 'unreachable' | null;

export function SourceInput({
  githubUrl,
  setGithubUrl,
  openapiUrl,
  setOpenapiUrl,
  onGithubSubmit,
  onOpenapiSubmit,
  githubError,
  githubAttempts,
  error,
  onComingSoonClick,
}: {
  githubUrl: string;
  setGithubUrl: (v: string) => void;
  openapiUrl: string;
  setOpenapiUrl: (v: string) => void;
  onGithubSubmit: (e: React.FormEvent) => void;
  onOpenapiSubmit: (e: React.FormEvent) => void;
  githubError: GithubErrorKind;
  githubAttempts: GithubDetectAttempt;
  error: DetectError;
  onComingSoonClick: (target: 'docker') => void;
}) {
  return (
    <div data-testid="build-step-ramp">
      {/* RAMP 1 — GitHub import (PRIMARY) */}
      <form
        onSubmit={onGithubSubmit}
        data-testid="ramp-github"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--accent-border, var(--line))',
          borderRadius: 16,
          padding: 24,
          marginBottom: 20,
          boxShadow: '0 10px 30px rgba(5,150,105,0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <GithubIcon size={18} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            Import from GitHub
          </div>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Recommended
          </span>
          <span
            style={{
              marginLeft: 'auto',
              padding: '3px 10px',
              borderRadius: 999,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--muted)',
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            30 seconds
          </span>
        </div>
        <p
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            margin: '0 0 18px',
            lineHeight: 1.55,
            maxWidth: 620,
          }}
        >
          Paste your repo URL. Floom reads it and turns it into a live app: a Claude tool,
          a page to share, and a URL your teammates can hit.
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 6px 4px 12px',
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--bg)',
            marginBottom: 14,
            flexWrap: 'nowrap',
          }}
        >
          <GithubIcon size={14} />
          <input
            type="url"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            required
            placeholder="https://github.com/you/your-repo"
            data-testid="build-github-url"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 4px',
              border: 'none',
              background: 'transparent',
              fontSize: 14,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            data-testid="build-github-detect"
            disabled={!githubUrl}
            style={{
              padding: '8px 14px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: githubUrl ? 'pointer' : 'not-allowed',
              opacity: githubUrl ? 1 : 0.55,
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            Detect
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          Works with any public repo. Private repos coming soon.
        </div>

        {githubError && (
          <div
            data-testid={`github-error-${githubError}`}
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {githubError === 'no-openapi' && (
              <ErrorCard
                severity="red"
                title="We couldn't find your app file"
                copy="Floom needs an openapi.yaml (or .json) file in your repo root. Add one, or paste the direct link below. Importing from Docker images and agent wrappers is on the roadmap."
              />
            )}
            {githubError === 'private' && (
              <ErrorCard
                severity="amber"
                title="This repo looks private"
                copy="We can't reach it without permission. Make the repo public, or paste the direct link to your openapi.yaml below."
              />
            )}
            {githubError === 'unreachable' && (
              <ErrorCard
                severity="amber"
                title="That doesn't look like a GitHub URL"
                copy="Paste a full URL like https://github.com/owner/repo."
              />
            )}
            {githubAttempts && githubAttempts.attemptedUrls.length > 0 && (
              <details
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 12,
                }}
              >
                <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontWeight: 500 }}>
                  Paths we tried ({githubAttempts.attemptedUrls.length})
                </summary>
                <ul
                  style={{
                    margin: '8px 0 0',
                    padding: '0 0 0 16px',
                    color: 'var(--muted)',
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                    lineHeight: 1.7,
                  }}
                >
                  {githubAttempts.attemptedUrls.map((u) => (
                    <li key={u}>{u.replace('https://raw.githubusercontent.com/', '')}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </form>

      {/* RAMP 2 — OpenAPI URL paste (FUNCTIONAL). Round 2 polish
          (UI audit v2): previously hidden behind a "More ways to
          add an app (coming soon)" accordion that made the
          functional OpenAPI ramp invisible above the fold. Promote
          it directly under the primary GitHub card so both working
          ramps are side-by-side and no "coming soon" copy appears
          above the first real input. */}
      <form
        onSubmit={onOpenapiSubmit}
        data-testid="ramp-openapi"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 22,
          marginTop: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileIcon />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
            Paste your app's link
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
          Direct link to your app's openapi.json or openapi.yaml file.
        </p>
        <input
          type="url"
          value={openapiUrl}
          onChange={(e) => setOpenapiUrl(e.target.value)}
          required
          placeholder="https://api.example.com/openapi.json"
          data-testid="build-url-input"
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--bg)',
            fontSize: 14,
            color: 'var(--ink)',
            fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div
            data-testid="build-error"
            style={{
              margin: '0 0 12px',
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
        <button
          type="submit"
          data-testid="build-detect"
          disabled={!openapiUrl}
          style={primaryButton(!openapiUrl)}
        >
          Find it
        </button>
      </form>

      {/* More-ways footer — single collapsed disclosure after the
          functional ramps. Round 2 polish (UI audit v2): Docker
          + other non-shipping ramps must not be visible above the
          fold at 1440x900, so they live inside a closed <details>
          the creator can expand. This keeps "coming soon" copy
          off the initial view while leaving the Docker ramp
          discoverable. */}
      <details
        data-testid="build-more-ways-footer"
        style={{
          marginTop: 24,
          border: '1px solid var(--line)',
          borderRadius: 12,
          background: 'var(--bg)',
          padding: '0 4px',
        }}
      >
        <summary
          data-testid="build-more-ways-summary"
          style={{
            cursor: 'pointer',
            padding: '12px 14px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--muted)',
            userSelect: 'none',
          }}
        >
          More ways to add an app
        </summary>
        <div style={{ padding: '4px 12px 16px' }}>
          <RampCard
            icon={<DockerIcon />}
            title="Import from a Docker image"
            badge="Coming soon"
            desc="Paste an image and the path to your app file. Floom pulls it, scans it, and runs it for you."
            testId="ramp-docker"
            onClick={() => onComingSoonClick('docker')}
            compact
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                opacity: 0.85,
                flexWrap: 'wrap',
              }}
            >
              <input
                disabled
                placeholder="ghcr.io/you/app:latest"
                style={{
                  flex: '2 1 220px',
                  padding: '10px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  fontSize: 13,
                  color: 'var(--muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  boxSizing: 'border-box',
                }}
              />
              <input
                disabled
                placeholder="/openapi.yaml"
                style={{
                  flex: '1 1 140px',
                  padding: '10px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  fontSize: 13,
                  color: 'var(--muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </RampCard>
          <p
            style={{
              marginTop: 12,
              marginBottom: 0,
              fontSize: 12.5,
              color: 'var(--muted)',
              lineHeight: 1.55,
            }}
          >
            Describe-it and tool connectors ship with v1.1.{' '}
            <a
              href="/protocol"
              style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
            >
              Post to the roadmap &rarr;
            </a>
          </p>
        </div>
      </details>
    </div>
  );
}
