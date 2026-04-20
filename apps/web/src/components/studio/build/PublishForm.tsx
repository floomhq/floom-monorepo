import { Input, Label, VisibilityChooser } from './shared';

export function PublishForm({
  name,
  setName,
  description,
  setDescription,
  slug,
  visibility,
  setVisibility,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  slug: string;
  visibility: 'public' | 'private' | 'auth-required';
  setVisibility: (v: 'public' | 'private' | 'auth-required') => void;
}) {
  return (
    <>
      <Label>App name</Label>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="build-name"
      />

      <Label>Description</Label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        data-testid="build-description"
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--card)',
          fontSize: 14,
          color: 'var(--ink)',
          fontFamily: 'inherit',
          resize: 'vertical',
          minHeight: 80,
          boxSizing: 'border-box',
        }}
      />

      <Label>URL</Label>
      <div
        data-testid="build-slug-preview"
        style={{
          padding: '10px 12px',
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--bg)',
          fontSize: 13,
          color: 'var(--ink)',
          fontFamily: 'JetBrains Mono, monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ color: 'var(--muted)' }}>floom.dev/p/</span>
        <span>{slug || '...'}</span>
      </div>

      <Label>Visibility</Label>
      <VisibilityChooser
        value={visibility === 'auth-required' ? 'public' : visibility}
        onChange={(next) => setVisibility(next)}
      />
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
        You can flip this later from{' '}
        <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>/studio/{slug || '…'}</span>.
      </p>
    </>
  );
}
