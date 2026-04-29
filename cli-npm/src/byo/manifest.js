'use strict';

const fs = require('fs');
const path = require('path');

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== '\\') {
      quote = quote === ch ? null : (quote || ch);
    }
    if (ch === '#' && !quote && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function preprocess(source) {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const withoutComment = stripComment(line).replace(/\t/g, '  ');
      return {
        indent: withoutComment.match(/^ */)[0].length,
        text: withoutComment.trim(),
      };
    })
    .filter((line) => line.text);
}

function splitKeyValue(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'") && text[i - 1] !== '\\') {
      quote = quote === ch ? null : (quote || ch);
    }
    if (ch === ':' && !quote) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseScalar(value) {
  if (value === '') return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === '[]') return [];
  if (value === '{}') return {};
  return value;
}

function parseNode(lines, index, indent) {
  if (index >= lines.length || lines[index].indent < indent) return { value: {}, index };
  return lines[index].text.startsWith('- ')
    ? parseSequence(lines, index, indent)
    : parseMapping(lines, index, indent);
}

function parseMapping(lines, index, indent) {
  const obj = {};
  let i = index;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      i++;
      continue;
    }
    if (line.text.startsWith('- ')) break;

    const pair = splitKeyValue(line.text);
    if (!pair) {
      i++;
      continue;
    }
    const [key, rawValue] = pair;
    if (rawValue === '') {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const parsed = parseNode(lines, i + 1, next.indent);
        obj[key] = parsed.value;
        i = parsed.index;
      } else {
        obj[key] = {};
        i++;
      }
    } else {
      obj[key] = parseScalar(rawValue);
      i++;
    }
  }
  return { value: obj, index: i };
}

function parseSequence(lines, index, indent) {
  const arr = [];
  let i = index;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith('- ')) break;

    const itemText = line.text.slice(2).trim();
    if (itemText === '') {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const parsed = parseNode(lines, i + 1, next.indent);
        arr.push(parsed.value);
        i = parsed.index;
      } else {
        arr.push(null);
        i++;
      }
      continue;
    }

    const pair = splitKeyValue(itemText);
    if (!pair) {
      arr.push(parseScalar(itemText));
      i++;
      continue;
    }

    const [key, rawValue] = pair;
    const item = {};
    if (rawValue === '') {
      const next = lines[i + 1];
      if (next && next.indent > indent) {
        const parsed = parseNode(lines, i + 1, next.indent);
        item[key] = parsed.value;
        i = parsed.index;
      } else {
        item[key] = {};
        i++;
      }
    } else {
      item[key] = parseScalar(rawValue);
      i++;
    }

    while (i < lines.length && lines[i].indent > indent) {
      const parsed = parseMapping(lines, i, lines[i].indent);
      Object.assign(item, parsed.value);
      i = parsed.index;
    }
    arr.push(item);
  }
  return { value: arr, index: i };
}

function parseYamlSubset(source) {
  const lines = preprocess(source);
  if (lines.length === 0) return {};
  return parseNode(lines, 0, lines[0].indent).value;
}

function slugify(value) {
  return String(value || 'app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function loadByoManifest(repoDir) {
  const yamlPath = path.join(repoDir, 'floom.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`no floom.yaml in ${repoDir}`);
  }

  const source = fs.readFileSync(yamlPath, 'utf8');
  const manifest = parseYamlSubset(source);
  const runtime = manifest.runtime && typeof manifest.runtime === 'object' ? manifest.runtime : null;
  const byo = runtime && runtime.byo && typeof runtime.byo === 'object' ? runtime.byo : null;
  if (!byo) {
    throw new Error('runtime.byo is missing; use `floom deploy` for existing Floom Cloud manifests');
  }

  const name = String(manifest.name || manifest.displayName || manifest.slug || 'app');
  const slug = slugify(manifest.slug || name);
  const actions = arrayOf(manifest.actions);
  const inputs = arrayOf(manifest.inputs);

  return {
    path: yamlPath,
    repoDir,
    manifest,
    byo,
    name,
    slug,
    actions,
    inputs,
  };
}

module.exports = {
  loadByoManifest,
  parseYamlSubset,
  slugify,
};
