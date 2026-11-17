import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new WeakMap();

function validator(schema) {
  let v = cache.get(schema);
  if (!v) {
    v = ajv.compile(schema);
    cache.set(schema, v);
  }
  return v;
}

// Pulls the first balanced JSON object out of a model reply. Handles code
// fences and leading chatter from models without schema enforcement.
export function extractJsonObject(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

export function parseAndValidate(textOrObject, schema) {
  let value = textOrObject;
  if (typeof textOrObject === 'string') {
    const raw = extractJsonObject(textOrObject);
    if (!raw) return { ok: false, errors: 'reply contains no JSON object' };
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return { ok: false, errors: `JSON parse error: ${err.message}` };
    }
  }
  const v = validator(schema);
  if (!v(value)) {
    return { ok: false, value, errors: v.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ') };
  }
  return { ok: true, value };
}
