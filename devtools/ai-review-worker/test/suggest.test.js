import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSuggestion, suggestionBlock } from '../src/suggest.js';
import { planInlineComments } from '../src/inline.js';
import { parseDiff } from '../src/diffparse.js';
import { parseConfigText, resolveProject } from '../src/config.js';

const FILE = [
  '// Throwaway file.',
  'export function pageOf(items, page, size) {',
  '  const start = (page - 1) * size;',
  '  return items.slice(start, start + size - 1);',
  '}',
  '',
  'const GITLAB_TOKEN = "[redacted glpa…]";',
];

test('a real replacement is kept, with the replaced block located', () => {
  const r = checkSuggestion('-  return items.slice(start, start + size - 1);\n+  return items.slice(start, start + size);', { fileLines: FILE, line: 4 });
  assert.ok(r);
  assert.deepEqual(r.replace, { startLine: 4, count: 1, lines: ['  return items.slice(start, start + size);'] });
});

test('context lines are part of the replaced block', () => {
  const r = checkSuggestion('   const start = (page - 1) * size;\n-  return items.slice(start, start + size - 1);\n+  return items.slice(start, start + size);', { fileLines: FILE, line: 4 });
  assert.deepEqual(r.replace, { startLine: 3, count: 2, lines: ['  const start = (page - 1) * size;', '  return items.slice(start, start + size);'] });
});

test('noise is dropped: quoting the line back, no-op, invented before-code, no file', () => {
  // The old noise: the criticised line repeated with `+`.
  assert.equal(checkSuggestion('+const GITLAB_TOKEN = "[redacted glpa…]";', { fileLines: FILE }), null);
  assert.equal(checkSuggestion('+export function pageOf(items, page, size) {', { fileLines: FILE }), null);
  // Same before and after.
  assert.equal(checkSuggestion('-  const start = (page - 1) * size;\n+  const start = (page - 1) * size;', { fileLines: FILE }), null);
  // `-` lines that are not in the file.
  assert.equal(checkSuggestion('-  return foo();\n+  return bar();', { fileLines: FILE }), null);
  // Nothing to check against.
  assert.equal(checkSuggestion('-a\n+b', { fileLines: null }), null);
  assert.equal(checkSuggestion('', { fileLines: FILE }), null);
});

test('a real addition is kept (new code with context)', () => {
  const r = checkSuggestion('   const start = (page - 1) * size;\n+  if (start >= items.length) return [];', { fileLines: FILE, line: 3 });
  assert.ok(r);
  assert.equal(r.replace.startLine, 3);
  assert.deepEqual(r.replace.lines, ['  const start = (page - 1) * size;', '  if (start >= items.length) return [];']);
  // A bare `+` line with no context says nothing about where it goes.
  assert.equal(checkSuggestion('+export const MAX_PAGE = 100;', { fileLines: FILE }), null);
});

// Cases replayed from real model output on qestor-core !36 / qestor-web !69.
test('replayed: redacted text is never "new code"', () => {
  const real = [...FILE.slice(0, 6), 'const GITLAB_TOKEN = "glpat-AbCdEfGhIjKlMnOpQrSt12";'];
  assert.equal(checkSuggestion('+const GITLAB_TOKEN = "[redacted glpa…]";', { fileLines: real }), null);
});

test('replayed: a quoted +X before -X is removed, so the suggestion does not duplicate the line', () => {
  const file = ['function f(ids) {', '  return {', '      assignees: ids.map((user_id) => ({ ...kept.get(user_id), user_id, active: true })),', '  };', '}'];
  const d = '+      assignees: ids.map((user_id) => ({ ...kept.get(user_id), user_id, active: true })),\n-      assignees: ids.map((user_id) => ({ ...kept.get(user_id), user_id, active: true })),\n+      assignees: ids.map((user_id) => {\n+        const existing = kept.get(user_id);\n+        return { ...(existing ?? {}), user_id, active: true };\n+      }),';
  const r = checkSuggestion(d, { fileLines: file, line: 3 });
  assert.deepEqual(r.replace, { startLine: 3, count: 1, lines: ['      assignees: ids.map((user_id) => {', '        const existing = kept.get(user_id);', '        return { ...(existing ?? {}), user_id, active: true };', '      }),'] });
});

test('replayed: unchanged lines marked + above the change become context', () => {
  const file = ['/** Number of pages for `count` items. */', 'export function pageCount(count, size) {', '  return Math.ceil(count / size);', '}'];
  const d = '+/** Number of pages for `count` items. */\n+export function pageCount(count, size) {\n-  return Math.ceil(count / size);\n+  if (!Number.isInteger(size) || size < 1) throw new RangeError(\'size\');\n+  return Math.max(1, Math.ceil(count / size));\n+';
  const r = checkSuggestion(d, { fileLines: file, line: 3 });
  assert.equal(r.replace.startLine, 1);
  assert.equal(r.replace.count, 3);
  assert.deepEqual(r.replace.lines, ['/** Number of pages for `count` items. */', 'export function pageCount(count, size) {', "  if (!Number.isInteger(size) || size < 1) throw new RangeError('size');", '  return Math.max(1, Math.ceil(count / size));']);
  assert.match(r.diff, /^ \/\*\* Number of pages/);
});

test('replayed: the MR change pasted back in reverse is dropped (its - lines are not in the file)', () => {
  const file = ['  const root = catalogItems.find((i) => i.id === rootId);', "  if (!root) throw new Error('item_not_found');"];
  const d = "+  const root = catalogItems.find((i) => i.id === rootId);\n+  if (!root) throw new Error('item_not_found');\n-  const root = data.items.find((i) => i.id === rootId);\n-  if (!root) return null;";
  assert.equal(checkSuggestion(d, { fileLines: file, line: 1 }), null);
});

test('suggestionBlock uses GitLab multi-line syntax and a longer fence when needed', () => {
  assert.equal(suggestionBlock({ startLine: 4, count: 1, lines: ['  x();'] }), '```suggestion:-0+0\n  x();\n```');
  assert.equal(suggestionBlock({ startLine: 3, count: 2, lines: ['a', '```b'] }), '````suggestion:-0+1\na\n```b\n````');
  // Deleting a line: an empty suggestion.
  assert.equal(suggestionBlock({ startLine: 7, count: 1, lines: [] }), '```suggestion:-0+0\n\n```');
});

const DIFF = `diff --git a/scratch/p.js b/scratch/p.js
new file mode 100644
--- /dev/null
+++ b/scratch/p.js
@@ -0,0 +1,7 @@
${FILE.map((l) => `+${l}`).join('\n')}
`;

test('line comments use a one-click suggestion when the replaced lines are in the diff', () => {
  const c = resolveProject(parseConfigText('{}'), 'g/p');
  const files = parseDiff(DIFF);
  const fix = checkSuggestion('-  return items.slice(start, start + size - 1);\n+  return items.slice(start, start + size);', { fileLines: FILE, line: 4 });
  const review = {
    blockers: [{ repo: '', title: 'slice end off by one', file: 'scratch/p.js', line: 4, detail: 'd', suggestion: 's', diff: fix.diff, replace: fix.replace }],
    potentialBugs: [{ repo: '', title: 'no fix to show', file: 'scratch/p.js', line: 2, detail: 'd', suggestion: '', diff: '', replace: null }],
    recommendations: [],
  };
  const job = { base_sha: 'b'.repeat(40), head_sha: 'h'.repeat(40) };
  const plan = planInlineComments({ review, files, job, cfg: c });
  assert.equal(plan.comments.length, 2);
  assert.equal(plan.comments[0].suggestion, true);
  assert.equal(plan.comments[0].line, 4);
  assert.match(plan.comments[0].body, /```suggestion:-0\+0\n {2}return items\.slice\(start, start \+ size\);\n```/);
  assert.ok(!plan.comments[0].body.includes('```diff'));
  assert.equal(plan.comments[1].suggestion, false);
  assert.ok(!plan.comments[1].body.includes('```'));
});
