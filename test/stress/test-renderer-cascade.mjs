#!/usr/bin/env node
// v16 renderer cascade tests.
//
// Exercises pickRenderer + autoPick from
// apps/web/src/components/output/rendererCascade.tsx. Runs under tsx so
// the TSX file can import its sibling components without a build step.
//
// Coverage:
//   - Layer 2: manifest-declared output_component → right library mount
//   - Layer 2 miss (typo in component name) → falls through to Layer 3
//   - Layer 2 miss (missing *_field reference) → falls through to Layer 3
//   - Layer 3: auto-pick html → FileDownload
//   - Layer 3: auto-pick markdown/summary/report → Markdown
//   - Layer 3: short string → TextBig
//   - Layer 3: code-like string with language hint → CodeBlock
//   - Layer 4: no match → kind:'fallback', element:null
//
// The test avoids mounting a full React tree; it checks component
// identity via the element's `type` pointer (react element shape).

import { pickRenderer, OUTPUT_LIBRARY, __test__ } from '../../apps/web/src/components/output/rendererCascade.tsx';

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

function mkManifest(opts) {
  return {
    name: 'Test App',
    description: 't',
    actions: {
      go: {
        label: 'Go',
        inputs: [],
        outputs: opts.outputs ?? [],
      },
    },
    runtime: 'python',
    python_dependencies: [],
    node_dependencies: {},
    secrets_needed: [],
    manifest_version: '2.0',
    ...(opts.render ? { render: opts.render } : {}),
  };
}

console.log('v16 renderer cascade tests');

// ---------- Layer 2: manifest-declared component ----------

{
  const app = {
    manifest: mkManifest({
      render: { output_component: 'TextBig', value_field: 'uuids', copyable: true },
      outputs: [{ name: 'response', label: 'Response', type: 'json' }],
    }),
  };
  const out = { uuids: ['abc-123'], version: 'v4', count: 1 };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Layer 2: TextBig picked by output_component', result.kind === 'library');
  log('Layer 2: TextBig component identity matches', result.element?.type === OUTPUT_LIBRARY.TextBig);
  log('Layer 2: value_field plucked first array entry', result.element?.props.value === 'abc-123');
  log('Layer 2: copyable prop passed through', result.element?.props.copyable === true);
}

{
  const app = {
    manifest: mkManifest({
      render: { output_component: 'CodeBlock', code_field: 'formatted', language: 'json' },
      outputs: [{ name: 'response', label: 'Response', type: 'json' }],
    }),
  };
  const out = { formatted: '{\n  "a": 1\n}', minified: '{"a":1}' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Layer 2: CodeBlock picked', result.kind === 'library');
  log('Layer 2: CodeBlock code prop populated', result.element?.props.code === '{\n  "a": 1\n}');
  log('Layer 2: CodeBlock language prop preserved', result.element?.props.language === 'json');
}

{
  const app = {
    manifest: mkManifest({
      render: {
        output_component: 'FileDownload',
        bytes_field: 'pdf_base64',
        filename: 'slides.pdf',
        mime: 'application/pdf',
        previewHtml_field: 'preview',
      },
      outputs: [],
    }),
  };
  const out = {
    pdf_base64: 'JVBERi0xLjQK',
    preview: '<h1>slide 1</h1>',
  };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Layer 2: FileDownload picked', result.kind === 'library');
  log('Layer 2: bytes plucked', result.element?.props.bytes === 'JVBERi0xLjQK');
  log('Layer 2: filename passed through', result.element?.props.filename === 'slides.pdf');
  log('Layer 2: previewHtml_field plucked', result.element?.props.previewHtml === '<h1>slide 1</h1>');
}

// ---------- Layer 2 miss: typo in component name falls through ----------

{
  const app = {
    manifest: mkManifest({
      render: { output_component: 'TextBigg', value_field: 'x' },
      outputs: [{ name: 'summary', label: 'Summary', type: 'markdown' }],
    }),
  };
  const out = { summary: 'Important finding.', x: 'ignored' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Typo in output_component falls through to auto-pick', result.kind === 'auto');
  log('Fall-through picks Markdown for summary field', result.element?.type === OUTPUT_LIBRARY.Markdown);
}

// ---------- Layer 2 miss: missing *_field reference falls through ----------

{
  const app = {
    manifest: mkManifest({
      render: { output_component: 'TextBig', value_field: 'missing' },
      outputs: [{ name: 'summary', label: 'Summary', type: 'markdown' }],
    }),
  };
  const out = { summary: 'Fallback content.' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Missing *_field falls through (no render error)', result.kind === 'auto');
  log('Markdown content plucked by auto-pick', result.element?.props.content === 'Fallback content.');
}

// ---------- Layer 3: auto-pick heuristics ----------

{
  const app = {
    manifest: mkManifest({
      outputs: [{ name: 'preview', label: 'Preview', type: 'html' }],
    }),
  };
  const out = { preview: '<h1>Hello</h1>' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Auto-pick: html type → FileDownload', result.element?.type === OUTPUT_LIBRARY.FileDownload);
  log('Auto-pick: previewHtml set from html field', result.element?.props.previewHtml === '<h1>Hello</h1>');
}

{
  const app = {
    manifest: mkManifest({
      outputs: [{ name: 'report', label: 'Report', type: 'markdown' }],
    }),
  };
  const out = { report: '# Findings\n\nSome text.' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Auto-pick: report field → Markdown', result.element?.type === OUTPUT_LIBRARY.Markdown);
}

{
  const app = {
    manifest: mkManifest({
      outputs: [{ name: 'answer', label: 'Answer', type: 'text' }],
    }),
  };
  const out = { answer: '42' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Auto-pick: single short string → TextBig', result.element?.type === OUTPUT_LIBRARY.TextBig);
  log('Auto-pick: TextBig value plucked', result.element?.props.value === '42');
}

{
  const app = {
    manifest: mkManifest({
      outputs: [{ name: 'payload', label: 'Payload', type: 'text' }],
    }),
  };
  const out = { payload: '{"a":1,"b":[2,3,4]}' };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('Auto-pick: json-ish string → CodeBlock', result.element?.type === OUTPUT_LIBRARY.CodeBlock);
  log('Auto-pick: CodeBlock language inferred', result.element?.props.language === 'json');
}

// ---------- Layer 4: genuine fallback ----------

{
  const app = {
    manifest: mkManifest({
      outputs: [{ name: 'response', label: 'Response', type: 'json' }],
    }),
  };
  const out = { response: { nested: { shape: true } } };
  const result = pickRenderer({ app, action: 'go', runOutput: out });
  log('No match → kind=fallback, element=null', result.kind === 'fallback' && result.element === null);
}

// ---------- resolveRenderProps edge cases ----------

{
  const resolved = __test__.resolveRenderProps(
    { output_component: 'X', filename: 'a.bin', extra: true, value_field: 'v' },
    { v: 'hello' },
  );
  log('resolveRenderProps: output_component stripped', resolved.output_component === undefined);
  log('resolveRenderProps: non-_field keys pass through', resolved.filename === 'a.bin' && resolved.extra === true);
  log('resolveRenderProps: _field resolved', resolved.value === 'hello');
}

{
  const resolved = __test__.resolveRenderProps(
    { value_field: 'missing' },
    { other: 'thing' },
  );
  log('resolveRenderProps: missing field → null (bail)', resolved === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
