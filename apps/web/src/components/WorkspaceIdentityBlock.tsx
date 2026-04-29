// WorkspaceIdentityBlock — top-of-rail workspace chip.
//
// Behaviour:
//   - Always opens a dropdown switcher in-place.
//   - Dropdown lists all workspaces, marks the active one, lets the user
//     switch via POST /api/session/switch-workspace, and includes
//     "Create new workspace" plus "Workspace settings →" actions.
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
  fontFamily: 'var(--font-mono)',
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

function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { refresh } = useSession();

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

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

  async function handleCreate() {
    const name = newName.trim();
    if (!name || switching) return;
    setSwitching('new');
    setError(null);
    try {
      await api.createWorkspace({ name });
      await refresh();
      await refreshMyApps();
      setNewName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace');
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

      <div style={{ height: 1, background: 'var(--line)', margin: '6px 4px' }} />

      {!creating ? (
        <button
          type="button"
          role="menuitem"
          data-testid="workspace-create-new"
          onClick={() => {
            setCreating(true);
            setError(null);
          }}
          disabled={switching !== null}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '9px 10px',
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--ink)',
            fontWeight: 600,
            cursor: switching ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            textAlign: 'left',
          }}
        >
          <PlusIcon size={12} />
          <span>Create new workspace</span>
        </button>
      ) : (
        <div style={createWrapStyle}>
          <label htmlFor="workspace-create-name" style={createLabelStyle}>
            Create new workspace
          </label>
          <input
            ref={inputRef}
            id="workspace-create-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder="Workspace name"
            data-testid="workspace-create-input"
            style={createInputStyle}
          />
          <div style={createActionsStyle}>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName('');
                setError(null);
              }}
              style={secondaryActionStyle}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleCreate(); }}
              disabled={!newName.trim() || switching !== null}
              style={primaryActionStyle(!newName.trim() || switching !== null)}
            >
              {switching === 'new' ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

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
  const menuWorkspaces =
    active && !workspaces.some((workspace) => workspace.id === active.id)
      ? [active, ...workspaces]
      : workspaces;

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
          workspaces={menuWorkspaces}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const createWrapStyle: CSSProperties = {
  padding: 8,
  borderRadius: 8,
  background: 'var(--bg)',
};

const createLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
};

const createInputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '8px 9px',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--card)',
  outline: 'none',
  boxSizing: 'border-box',
};

const createActionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
  marginTop: 8,
};

const secondaryActionStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 7,
  padding: '6px 9px',
  background: 'var(--card)',
  color: 'var(--muted)',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
};

function primaryActionStyle(disabled: boolean): CSSProperties {
  return {
    border: '1px solid var(--ink)',
    borderRadius: 7,
    padding: '6px 9px',
    background: 'var(--ink)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
