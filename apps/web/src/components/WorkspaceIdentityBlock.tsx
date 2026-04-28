// WorkspaceIdentityBlock — top-of-rail workspace chip.
//
// Behaviour:
//   - Single workspace: acts as a Link to /settings (workspace settings).
//   - Multiple workspaces: opens a dropdown switcher in-place.
//     Dropdown lists all workspaces, marks the active one, and lets the
//     user switch via POST /api/session/switch-workspace. Has a
//     "Workspace settings →" footer link to /settings.
//
// Used in RunRail + StudioRail. The chip shape is the same in both modes;
// the switcher dropdown is generic (no mode-specific chrome).

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { refreshMyApps } from '../hooks/useMyApps';
import * as api from '../api/client';
import type { SessionWorkspace } from '../lib/types';

// ─── Chip (trigger) ──────────────────────────────────────────────────────────

// Wireframe spec: .ws-identity { border: 1px solid transparent; border-radius: 9px; }
// No card chrome at rest — hover reveals background + border.
const chipStyle: CSSProperties = {
  minHeight: 40,
  padding: '9px 10px',
  border: '1px solid transparent',
  borderRadius: 9,
  background: 'transparent',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 2,
  cursor: 'pointer',
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  fontFamily: 'inherit',
  transition: 'background 0.12s, border-color 0.12s',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  lineHeight: 1,
};

const nameRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};

const nameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
  flex: 1,
  minWidth: 0,
};

function ChevronDown({ open }: { open?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        color: 'var(--muted)',
        transform: open ? 'rotate(180deg)' : undefined,
        transition: 'transform 0.15s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--accent)' }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        color: 'var(--muted)',
        animation: 'floom-spin 0.9s linear infinite',
      }}
    >
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}

// ─── Dropdown menu ────────────────────────────────────────────────────────────

interface SwitcherMenuProps {
  active: SessionWorkspace;
  workspaces: SessionWorkspace[];
  onClose: () => void;
}

function SwitcherMenu({ active, workspaces, onClose }: SwitcherMenuProps) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useSession();

  async function handleSelect(id: string) {
    if (switching || id === active.id) {
      onClose();
      return;
    }
    setSwitching(id);
    setError(null);
    try {
      await api.switchWorkspace(id);
      await refresh();
      await refreshMyApps();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch workspace');
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div
      role="menu"
      data-testid="workspace-switcher-menu"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        zIndex: 60,
        padding: 6,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(17,24,39,0.1)',
        minWidth: 0,
      }}
    >
      {workspaces.map((ws) => {
        const isActive = ws.id === active.id;
        const isBusy = switching !== null;
        const isSwitching = switching === ws.id;
        return (
          <button
            key={ws.id}
            type="button"
            role="menuitem"
            data-testid={`workspace-option-${ws.slug ?? ws.id}`}
            onClick={() => { void handleSelect(ws.id); }}
            disabled={isBusy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '9px 10px',
              border: 'none',
              borderRadius: 8,
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--ink)',
              fontWeight: isActive ? 700 : 500,
              cursor: isBusy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              textAlign: 'left',
              opacity: isBusy && !isSwitching ? 0.6 : 1,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ws.name}
            </span>
            {isSwitching ? <Spinner size={12} /> : isActive ? <CheckIcon size={12} /> : null}
          </button>
        );
      })}

      {error && (
        <div
          role="alert"
          style={{
            margin: '4px 6px 2px',
            padding: '8px 10px',
            borderRadius: 8,
            background: '#fef2f2',
            color: '#b42318',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ height: 1, background: 'var(--line)', margin: '6px 4px' }} />
      <Link
        to="/settings"
        data-testid="workspace-settings-link"
        role="menuitem"
        onClick={onClose}
        style={{
          display: 'block',
          padding: '9px 10px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--muted)',
          textDecoration: 'none',
        }}
      >
        Workspace settings →
      </Link>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function WorkspaceIdentityBlock() {
  const { data } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const workspaceName = data?.active_workspace?.name?.trim() || 'Workspace';
  const active = data?.active_workspace ?? null;
  const workspaces: SessionWorkspace[] = data?.workspaces ?? [];
  const hasMultiple = workspaces.length > 1;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.background = 'var(--card)';
      e.currentTarget.style.borderColor = 'var(--line)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (!open) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }
    },
  };

  // Single workspace: plain link to settings
  if (!hasMultiple) {
    return (
      <Link
        to="/settings"
        data-testid="workspace-identity-block"
        title="Workspace settings"
        style={{ ...chipStyle, textDecoration: 'none' }}
        {...hoverHandlers}
      >
        <span style={eyebrowStyle}>Workspace</span>
        <div style={nameRowStyle}>
          <span style={nameStyle}>{workspaceName}</span>
          <ChevronDown />
        </div>
      </Link>
    );
  }

  // Multiple workspaces: dropdown switcher
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="workspace-identity-block"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={open ? { ...chipStyle, background: 'var(--card)', borderColor: 'var(--line)' } : chipStyle}
        {...hoverHandlers}
      >
        <span style={eyebrowStyle}>Workspace</span>
        <div style={nameRowStyle}>
          <span style={nameStyle}>{workspaceName}</span>
          <ChevronDown open={open} />
        </div>
      </button>
      {open && active && (
        <SwitcherMenu
          active={active}
          workspaces={workspaces}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
