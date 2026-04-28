// /run/apps/:slug/run — consumer run surface in the v26 workspace shell.
//
// Mirrors the data/logic of MeAppRunPage (v23) but mounts inside
// WorkspacePageShell mode="run" with the RunAppTabs tab strip.
// The RunSurface component is reused directly — same input/output split,
// same secrets gate, same async-job poll path.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspacePageShell } from '../components/WorkspacePageShell';
import { RunAppTabs } from '../components/RunAppTabs';
import { SecretsRequiredCard } from '../components/me/SecretsRequiredCard';
import { RunSurface } from '../components/runner/RunSurface';
import { AppIcon } from '../components/AppIcon';
import { useSecrets } from '../hooks/useSecrets';
import * as api from '../api/client';
import type { AppDetail } from '../lib/types';
import { collectRequiredSecretKeys } from '../lib/manifest-secrets';

// Same override map as MeAppRunPage — ig-nano-scout cookies are optional
// for the scraper; only the hard-required keys gate the run.
const REQUIRED_SECRETS_OVERRIDE: Record<string, string[]> = {
  'ig-nano-scout': [
    'IG_SESSIONID',
    'IG_CSRFTOKEN',
    'IG_DS_USER_ID',
    'EVOMI_PROXY_URL',
  ],
};

export function RunAppRunPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secrets = useSecrets();

  // Deep-link prefill: same ?prompt= convention as MeAppRunPage.
  const prefillPrompt = searchParams.get('prompt');
  const initialInputs = useMemo<Record<string, unknown> | undefined>(
    () => (prefillPrompt ? { prompt: prefillPrompt } : undefined),
    [prefillPrompt],
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    api
      .getApp(slug)
      .then((res) => {
        if (!cancelled) setApp(res);
      })
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          nav('/run/apps', { replace: true });
          return;
        }
        setError((err as Error).message || 'Failed to load app');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, nav]);

  const missingKeys = useMemo(() => {
    if (!app || !secrets.entries) return null;
    const declared = collectRequiredSecretKeys(app.manifest);
    const required = REQUIRED_SECRETS_OVERRIDE[app.slug] ?? declared;
    const keysSet = new Set(secrets.entries.map((s) => s.key));
    return required.filter((k) => !keysSet.has(k));
  }, [app, secrets.entries]);

  return (
    <WorkspacePageShell
      mode="run"
      title={app ? `${app.name} · Run · Floom` : 'Run · Floom'}
    >
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}
      >
        <Link to="/run/apps" style={{ color: 'var(--muted)', textDecoration: 'none' }}>
          Apps
        </Link>
        <span style={{ margin: '0 6px' }}>›</span>
        {app ? (
          <Link
            to={`/run/apps/${app.slug}/run`}
            style={{ color: 'var(--muted)', textDecoration: 'none' }}
          >
            {app.name}
          </Link>
        ) : (
          <span>{slug}</span>
        )}
        <span style={{ margin: '0 6px' }}>›</span>
        <span style={{ color: 'var(--ink)' }}>Run</span>
      </nav>

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid #f4b7b1',
            color: '#c2321f',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {!app && !error && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
      )}

      {app && (
        <>
          {/* App meta strip: icon + name + meta line */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background:
                  'radial-gradient(circle at 30% 25%, #d1fae5 0%, #ecfdf5 55%, #d1fae5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow:
                  'inset 0 0 0 1px rgba(5,150,105,0.15), 0 1px 2px rgba(5,150,105,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
              }}
            >
              <AppIcon slug={app.slug} size={22} color="#047857" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
                {app.name}
              </h1>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginTop: 3,
                }}
              >
                {app.slug}
                {app.version ? ` · v${app.version}` : ''}
              </div>
            </div>
          </div>

          {/* Tab strip */}
          <RunAppTabs slug={app.slug} activeTab="run" />

          {/* Secrets loading state */}
          {missingKeys === null && secrets.error && !secrets.entries && (
            <SecretsFetchError
              error={secrets.error}
              onRetry={() => { void secrets.refresh(); }}
            />
          )}

          {missingKeys === null && !(secrets.error && !secrets.entries) && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
          )}

          {/* Missing secrets gate */}
          {missingKeys && missingKeys.length > 0 && (
            <SecretsRequiredCard
              app={app}
              missingKeys={missingKeys}
              onSaved={() => { void secrets.refresh(); }}
            />
          )}

          {/* Run surface */}
          {missingKeys && missingKeys.length === 0 && (
            <RunSurface app={app} initialInputs={initialInputs} />
          )}

          {/* Cross-link strip */}
          <div
            style={{
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
              marginTop: 32,
              paddingTop: 20,
              borderTop: '1px solid var(--line)',
              fontSize: 13,
            }}
          >
            <Link
              to={`/run/runs?app=${app.slug}`}
              style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
            >
              View all runs for this app →
            </Link>
            <Link
              to="/settings/byok-keys"
              style={{ color: 'var(--muted)', textDecoration: 'none' }}
            >
              Workspace BYOK keys →
            </Link>
          </div>
        </>
      )}
    </WorkspacePageShell>
  );
}

function SecretsFetchError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const raw = (error.message || String(error)).trim();
  const detail = raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
  return (
    <div
      role="alert"
      style={{
        background: '#fdecea',
        border: '1px solid #f4b7b1',
        color: '#c2321f',
        padding: '12px 14px',
        borderRadius: 8,
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>Couldn't load your saved secrets.</span>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginLeft: 'auto',
            padding: '6px 14px',
            background: '#c2321f',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Retry
        </button>
      </div>
      {detail && (
        <div style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-word' }}>
          {detail}
        </div>
      )}
    </div>
  );
}
