import { useEffect, useState } from 'react';

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--muted)',
        marginBottom: 6,
        marginTop: 14,
      }}
    >
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        padding: '10px 12px',
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--card)',
        fontSize: 14,
        color: 'var(--ink)',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        ...(props.style || {}),
      }}
    />
  );
}

export function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    padding: '11px 20px',
    background: 'var(--ink)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
  };
}

/**
 * Segmented Public / Private control with one-line explainers.
 * Issue #129: replaces the old <select> that silently defaulted to Private
 * and had no inline copy explaining what each option meant. Keeps
 * `auth-required` out of the visible surface — it's an advanced mode; when
 * a creator wants it, they set it in the manifest. Exposing it here would
 * confuse the 95% case.
 */
export function VisibilityChooser({
  value,
  onChange,
}: {
  value: 'public' | 'private';
  onChange: (next: 'public' | 'private') => void;
}) {
  const options: Array<{
    id: 'public' | 'private';
    label: string;
    explainer: string;
  }> = [
    {
      id: 'public',
      label: 'Public',
      explainer: 'Appears in the Store. Anyone can run this app.',
    },
    {
      id: 'private',
      label: 'Private',
      explainer: 'Hidden from the Store. Only your signed-in sessions can run it.',
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Visibility"
      data-testid="build-visibility"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        marginTop: 4,
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <label
            key={opt.id}
            data-testid={`build-visibility-${opt.id}`}
            data-selected={selected ? 'true' : 'false'}
            style={{
              border: selected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
              background: selected ? 'var(--accent-soft, #e6f4ea)' : 'var(--card)',
              borderRadius: 10,
              padding: '12px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              transition: 'border-color 0.12s ease, background 0.12s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name="build-visibility"
                value={opt.id}
                checked={selected}
                onChange={() => onChange(opt.id)}
                data-testid={`build-visibility-${opt.id}-input`}
                style={{ accentColor: 'var(--accent)', margin: 0 }}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: selected ? 'var(--accent)' : 'var(--ink)',
                }}
              >
                {opt.label}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              {opt.explainer}
            </p>
          </label>
        );
      })}
    </div>
  );
}

export function StepBadge({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  // The CSS fallback on --accent-soft used to be #e9e6ff (purple), which
  // violates Floom's "green accent only" brand rule. Fall back to a green
  // tint so the active step reads clearly, and outline the active pill so
  // it stands out against completed ones.
  return (
    <span
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        fontWeight: 600,
        background: done ? '#e6f4ea' : active ? 'var(--accent-soft, #d7f1e0)' : 'var(--bg)',
        color: done ? '#1a7f37' : active ? 'var(--accent)' : 'var(--muted)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
      }}
    >
      {label}
    </span>
  );
}

export function RampCard({
  icon,
  title,
  badge,
  desc,
  onClick,
  testId,
  children,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  desc: string;
  onClick: () => void;
  testId: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: compact ? 18 : 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        color: 'var(--ink)',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
          {icon}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <span
          style={{
            marginLeft: 'auto',
            padding: '3px 10px',
            borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {badge}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.55 }}>{desc}</p>
      {children}
    </button>
  );
}

export function ErrorCard({
  severity,
  title,
  copy,
}: {
  severity: 'amber' | 'red';
  title: string;
  copy: string;
}) {
  const color = severity === 'amber' ? '#b45309' : '#991b1b';
  const bg = severity === 'amber' ? '#fef3c7' : '#fee2e2';
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 6,
          background: bg,
          color,
          marginBottom: 8,
        }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>{copy}</div>
    </div>
  );
}

export function ComingSoonRampModal({
  target,
  onClose,
}: {
  target: 'docker';
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const config = {
    docker: {
      title: 'Docker import (coming soon)',
      copy:
        'Importing apps from Docker is on the v1.1 roadmap. For now, host your app\u2019s openapi.json somewhere public and paste the link.',
    },
  }[target];

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={`coming-soon-ramp-${target}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(14, 14, 12, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '28px 28px 24px',
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: 14,
          }}
        >
          Coming soon
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px', color: 'var(--ink)' }}>
          {config.title}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.55 }}>
          {config.copy}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function SignupToPublishModal({
  onClose,
  onContinue,
  onSignIn,
}: {
  onClose: () => void;
  onContinue: () => void;
  onSignIn: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="signup-to-publish-modal"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(14, 14, 12, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '28px 28px 24px',
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px', color: 'var(--ink)' }}>
          Sign up to publish this app
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.55 }}>
          Your app is saved. Create a free account to publish it to the store, get a live link,
          and see who runs it.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onSignIn}
            data-testid="signup-to-publish-signin"
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            I already have an account
          </button>
          <button
            type="button"
            onClick={onContinue}
            data-testid="signup-to-publish-continue"
            style={{
              padding: '10px 18px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShareableUrl({ slug }: { slug: string }) {
  // Publish-success shareable URL with one-click copy. Uses the live
  // origin so the copied value is a full https:// URL, not the relative
  // /p/slug that the old banner displayed.
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://floom.dev';
  const fullUrl = `${origin}/p/${slug}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked in some browsers; noop */
    }
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        border: '1px solid #b5dcc4',
        borderRadius: 8,
        padding: '8px 10px',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12.5,
        color: 'var(--ink)',
      }}
    >
      <span data-testid="build-done-url" style={{ userSelect: 'all' }}>{fullUrl}</span>
      <button
        type="button"
        onClick={copy}
        data-testid="build-done-copy"
        style={{
          padding: '4px 10px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/* -------------------------- icons -------------------------- */

export function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <use href="#icon-github" />
    </svg>
  );
}

export function DockerIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 14h16M6 14V9h2v5M10 14V9h2v5M14 14V9h2v5M8 14V5h2v4M18 14c0 4-3 6-7 6-4 0-6-2-7-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M10 13h6M10 17h6M10 9h2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
