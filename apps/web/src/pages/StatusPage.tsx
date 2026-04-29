import { useEffect, useRef, useState } from 'react';
import { PageShell } from '../components/PageShell';

// ── Envs ──────────────────────────────────────────────────────────────────

interface Env {
  name: string;
  label: string;
  url: string;
  healthUrl: string;
}

const ENVS: Env[] = [
  {
    name: 'prod',
    label: 'Production',
    url: 'https://floom.dev',
    healthUrl: 'https://floom.dev/api/health',
  },
  {
    name: 'mvp',
    label: 'MVP',
    url: 'https://mvp.floom.dev',
    healthUrl: 'https://mvp.floom.dev/api/health',
  },
  {
    name: 'preview',
    label: 'Preview',
    url: 'https://preview.floom.dev',
    healthUrl: 'https://preview.floom.dev/api/health',
  },
];

// ── Types ──────────────────────────────────────────────────────────────────

type HealthStatus = 'loading' | 'ok' | 'degraded';

interface HealthResult {
  status: HealthStatus;
  version: string | null;
  checkedAt: Date | null;
}

// ── Health fetcher ─────────────────────────────────────────────────────────

async function fetchHealth(healthUrl: string): Promise<{ version: string | null; ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, version: null };
    // Try to parse JSON for version SHA; gracefully degrade if shape differs.
    try {
      const json = await res.json();
      const version =
        (typeof json?.version === 'string' && json.version.trim()) ||
        (typeof json?.sha === 'string' && json.sha.trim()) ||
        (typeof json?.commit === 'string' && json.commit.trim()) ||
        null;
      return { ok: true, version: version ? version.slice(0, 7) : null };
    } catch {
      return { ok: true, version: null };
    }
  } catch {
    clearTimeout(timer);
    return { ok: false, version: null };
  }
}

// ── Status dot ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<HealthStatus, string> = {
  loading: '#f59e0b',
  ok: 'var(--success, #10b981)',
  degraded: 'var(--danger, #dc2626)',
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  loading: 'Checking…',
  ok: 'Operational',
  degraded: 'Degraded',
};

// ── Page ──────────────────────────────────────────────────────────────────

export function StatusPage() {
  const [results, setResults] = useState<Record<string, HealthResult>>(
    () =>
      Object.fromEntries(
        ENVS.map((e) => [e.name, { status: 'loading' as HealthStatus, version: null, checkedAt: null }]),
      ),
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0); // seconds since last poll

  const pollAll = () => {
    const now = new Date();
    setLastUpdated(now);
    setTick(0);

    for (const env of ENVS) {
      // Mark loading while re-fetching (preserve previous result so page stays
      // informative during the check).
      setResults((prev) => ({
        ...prev,
        [env.name]: { ...prev[env.name], status: 'loading' as HealthStatus, checkedAt: now },
      }));
      fetchHealth(env.healthUrl).then(({ ok, version }) => {
        setResults((prev) => ({
          ...prev,
          [env.name]: {
            status: ok ? 'ok' : 'degraded',
            version,
            checkedAt: now,
          },
        }));
      });
    }
  };

  // Initial poll + 30s re-poll.
  const pollRef = useRef(pollAll);
  pollRef.current = pollAll;

  useEffect(() => {
    pollRef.current();
    const intervalId = setInterval(() => pollRef.current(), 30_000);
    return () => clearInterval(intervalId);
  }, []);

  // "Last updated Xs ago" ticker.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Aggregate reflects Production only — internal envs (MVP, Preview) can
  // be degraded during deploys without impacting public-facing status.
  const prodResult = results['prod'];
  const allOk = prodResult?.status === 'ok';
  const anyLoading = prodResult?.status === 'loading';
  const overallLabel = anyLoading ? 'Checking…' : allOk ? 'All systems operational' : 'One or more systems degraded';
  const overallColor = anyLoading ? '#f59e0b' : allOk ? 'var(--success, #10b981)' : 'var(--danger, #dc2626)';

  return (
    <PageShell title="Status · Floom">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '56px 20px 72px' }}>
        {/* Header */}
        <p
          style={{
            margin: '0 0 10px',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            fontWeight: 700,
          }}
        >
          Status
        </p>
        <h1
          style={{
            margin: '0 0 8px',
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
          }}
        >
          Floom system status
        </h1>

        {/* Overall health summary */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 36,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: overallColor,
              flexShrink: 0,
            }}
          />
          <span style={{ color: overallColor, fontSize: 15, fontWeight: 600 }}>
            {overallLabel}
          </span>
        </div>

        {/* Environment rows */}
        <section
          aria-label="Environment health"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--card)',
            overflow: 'hidden',
          }}
        >
          {ENVS.map((env, idx) => {
            const result = results[env.name];
            const color = STATUS_COLOR[result.status];
            return (
              <div
                key={env.name}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px 20px',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '18px 20px',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                {/* Left: name + URL */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
                  <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{env.label}</strong>
                  <a
                    href={env.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      textDecoration: 'none',
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    }}
                  >
                    {env.url.replace('https://', '')}
                  </a>
                </div>

                {/* Middle: version SHA */}
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 12,
                    color: 'var(--muted)',
                    flex: '1 1 80px',
                    minWidth: 0,
                  }}
                >
                  {result.version ? result.version : '—'}
                </span>

                {/* Right: status dot + label */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 600,
                    color,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  {STATUS_LABEL[result.status]}
                </span>
              </div>
            );
          })}
        </section>

        {/* Last updated */}
        <p style={{ margin: '14px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          {lastUpdated
            ? `Last updated ${tick}s ago · auto-refreshes every 30s`
            : 'Checking…'}
        </p>

        {/* Contact */}
        <p style={{ margin: '28px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          For urgent production issues, email{' '}
          <a href="mailto:team@floom.dev" style={{ color: 'var(--accent)', fontWeight: 700 }}>
            team@floom.dev
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}
