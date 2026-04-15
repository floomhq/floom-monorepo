// Floom's default input components. 13 field types covering the common surface
// for consumer-grade schema-driven forms: text, textarea, date, url, enum,
// number, boolean, array, four file upload variants (CSV, image, audio, any),
// and nested object. Extend with your own widgets via the custom renderer API.
//
// Contract: every input component takes { spec, value, onChange, error? }
// where spec is a Floom InputSpec-like object.

import React from 'react';

export type InputValue = string | number | boolean | File | File[] | unknown;

export interface InputSpecLike {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  default?: unknown;
  options?: string[];
}

export interface InputProps<T extends InputValue = InputValue> {
  spec: InputSpecLike;
  value: T | undefined;
  onChange: (next: T) => void;
  error?: string;
}

function Label({ spec }: { spec: InputSpecLike }): React.ReactElement {
  return (
    <label className="floom-input-label" htmlFor={spec.name}>
      {spec.label}
      {spec.required && <span aria-label="required"> *</span>}
    </label>
  );
}

function Hint({ spec, error }: { spec: InputSpecLike; error?: string }): React.ReactElement | null {
  if (error) return <div className="floom-input-error" role="alert">{error}</div>;
  if (spec.description) return <div className="floom-input-hint">{spec.description}</div>;
  return null;
}

// 1. text — single-line string
export function TextInput({ spec, value, onChange, error }: InputProps<string>): React.ReactElement {
  return (
    <div className="floom-input floom-input-text">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={spec.placeholder}
        required={spec.required}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 2. textarea — long-form string
export function TextareaInput({ spec, value, onChange, error }: InputProps<string>): React.ReactElement {
  return (
    <div className="floom-input floom-input-textarea">
      <Label spec={spec} />
      <textarea
        id={spec.name}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={spec.placeholder}
        required={spec.required}
        rows={4}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 3. date — string:date
export function DateInput({ spec, value, onChange, error }: InputProps<string>): React.ReactElement {
  return (
    <div className="floom-input floom-input-date">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={spec.required}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

/**
 * Pure helper: apply https:// prefix when the user typed a bare domain.
 * Exported for tests.
 */
export function autoPrefixUrl(value: string | undefined): string {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// 4. url — string:uri with auto https://
export function UrlInput({ spec, value, onChange, error }: InputProps<string>): React.ReactElement {
  const handleBlur = React.useCallback(() => {
    if (value) {
      const normalized = autoPrefixUrl(value);
      if (normalized !== value) onChange(normalized);
    }
  }, [value, onChange]);
  return (
    <div className="floom-input floom-input-url">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="url"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={spec.placeholder || 'https://'}
        required={spec.required}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 5. enum — dropdown
export function EnumInput({ spec, value, onChange, error }: InputProps<string>): React.ReactElement {
  return (
    <div className="floom-input floom-input-enum">
      <Label spec={spec} />
      <select
        id={spec.name}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={spec.required}
      >
        {!spec.required && <option value="">—</option>}
        {(spec.options || []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 6. number — numeric input
export function NumberInput({ spec, value, onChange, error }: InputProps<number>): React.ReactElement {
  return (
    <div className="floom-input floom-input-number">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        placeholder={spec.placeholder}
        required={spec.required}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 7. boolean — toggle
export function BooleanInput({ spec, value, onChange, error }: InputProps<boolean>): React.ReactElement {
  return (
    <div className="floom-input floom-input-boolean">
      <label className="floom-input-label">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />{' '}
        {spec.label}
        {spec.required && <span aria-label="required"> *</span>}
      </label>
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 8. array — list editor
export function ArrayInput({ spec, value, onChange, error }: InputProps<string[]>): React.ReactElement {
  const items = Array.isArray(value) ? value : [];
  return (
    <div className="floom-input floom-input-array">
      <Label spec={spec} />
      <div className="floom-input-array-items">
        {items.map((item, i) => (
          <div key={i} className="floom-input-array-item" style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              aria-label="Remove item"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        aria-label="Add item"
      >
        + Add
      </button>
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 9. file: CSV
export function FileCsvInput({ spec, onChange, error }: InputProps<File>): React.ReactElement {
  return (
    <div className="floom-input floom-input-file-csv">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="file"
        accept=".csv,text/csv"
        required={spec.required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
        }}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 10. file: image
export function FileImageInput({ spec, onChange, error }: InputProps<File>): React.ReactElement {
  return (
    <div className="floom-input floom-input-file-image">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="file"
        accept="image/*"
        required={spec.required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
        }}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 11. file: PDF
export function FilePdfInput({ spec, onChange, error }: InputProps<File>): React.ReactElement {
  return (
    <div className="floom-input floom-input-file-pdf">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="file"
        accept="application/pdf,.pdf"
        required={spec.required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
        }}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 12. file: audio
export function FileAudioInput({ spec, onChange, error }: InputProps<File>): React.ReactElement {
  return (
    <div className="floom-input floom-input-file-audio">
      <Label spec={spec} />
      <input
        id={spec.name}
        type="file"
        accept="audio/*"
        required={spec.required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
        }}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

// 13. object — nested form (uses JSON textarea as the default — production
// usage should prefer rjsf for full recursive support)
export function ObjectInput({ spec, value, onChange, error }: InputProps<Record<string, unknown>>): React.ReactElement {
  const [text, setText] = React.useState(() =>
    value ? JSON.stringify(value, null, 2) : '{}',
  );
  return (
    <div className="floom-input floom-input-object">
      <Label spec={spec} />
      <textarea
        id={spec.name}
        value={text}
        rows={6}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            onChange(parsed);
          } catch {
            // leave the textarea in an invalid state; error prop surfaces it.
          }
        }}
        required={spec.required}
      />
      <Hint spec={spec} error={error} />
    </div>
  );
}

export const defaultInputs = {
  text: TextInput,
  textarea: TextareaInput,
  date: DateInput,
  url: UrlInput,
  enum: EnumInput,
  number: NumberInput,
  boolean: BooleanInput,
  array: ArrayInput,
  'file/csv': FileCsvInput,
  'file/image': FileImageInput,
  'file/pdf': FilePdfInput,
  'file/audio': FileAudioInput,
  object: ObjectInput,
};

/** List the 13 input kinds shipped by default. */
export const defaultInputKinds: string[] = Object.keys(defaultInputs);

/** Lookup a default input component by kind. Unknown kinds fall back to text. */
export function getDefaultInput(
  kind: string | undefined | null,
): React.ComponentType<InputProps<InputValue>> {
  const lookup = (defaultInputs as Record<string, React.ComponentType<InputProps<InputValue>>>)[
    kind || ''
  ];
  return lookup || (TextInput as unknown as React.ComponentType<InputProps<InputValue>>);
}
