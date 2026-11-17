import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Self-contained schemas (no $ref), because llama.cpp grammars, OpenAI
// response_format and Anthropic tool input_schema each want one inline object.
const dir = new URL('../schema/', import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(name, dir)), 'utf8'));

function inlineRefs(node, defs) {
  if (Array.isArray(node)) return node.map((n) => inlineRefs(n, defs));
  if (node && typeof node === 'object') {
    if (node.$ref && node.$ref.startsWith('#/definitions/')) return inlineRefs(defs[node.$ref.slice(14)], defs);
    const out = {};
    for (const [k, v] of Object.entries(node)) if (k !== 'definitions' && k !== '$id') out[k] = inlineRefs(v, defs);
    return out;
  }
  return node;
}

const reviewRaw = read('review.json');
export const REVIEW_SCHEMA = inlineRefs(reviewRaw, reviewRaw.definitions ?? {});

const stepRaw = read('step.json');
stepRaw.properties.review = REVIEW_SCHEMA;
export const STEP_SCHEMA = stepRaw;

// The last round may only review.
export const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'review'],
  properties: { action: { enum: ['review'] }, review: REVIEW_SCHEMA },
};
