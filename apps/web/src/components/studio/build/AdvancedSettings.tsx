import { Input, Label } from './shared';

export function AdvancedSettings({
  slug,
  onSlugChange,
  category,
  setCategory,
}: {
  slug: string;
  onSlugChange: (next: string) => void;
  category: string;
  setCategory: (next: string) => void;
}) {
  return (
    <details
      data-testid="build-advanced-settings"
      style={{
        marginTop: 24,
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--bg)',
      }}
    >
      <summary
        data-testid="build-advanced-settings-summary"
        style={{
          cursor: 'pointer',
          padding: '12px 14px',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--muted)',
          userSelect: 'none',
        }}
      >
        Advanced settings
      </summary>
      <div style={{ padding: '4px 14px 16px' }}>
        <Label>Custom slug</Label>
        <Input
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          data-testid="build-slug"
        />
        <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>
          Only lowercase letters, numbers, and dashes. Other characters are replaced automatically.
        </p>

        <Label>Category (optional)</Label>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. travel, coding, productivity"
          data-testid="build-category"
        />
      </div>
    </details>
  );
}
