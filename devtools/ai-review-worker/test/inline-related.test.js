import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseDiff, positionFor, nearestDiffLine } from '../src/diffparse.js';
import { planInlineComments } from '../src/inline.js';
import { changedSymbols, gatherRelated } from '../src/related.js';
import { normalizeReview } from '../src/verdict.js';
import { parseConfigText, resolveProject } from '../src/config.js';
import { Repo } from '../src/git.js';

const cfg = (yaml = '{}') => resolveProject(parseConfigText(yaml), 'g/p');

const DIFF = `diff --git a/src/page.js b/src/page.js
index 1111111..2222222 100644
--- a/src/page.js
+++ b/src/page.js
@@ -10,4 +10,5 @@ export function pageOf(items, page, size) {
   const start = (page - 1) * size;
-  return items.slice(start, start + size);
+  return items.slice(start, start + size - 1);
+  // note
 }
diff --git a/old/name.js b/new/name.js
similarity index 90%
rename from old/name.js
rename to new/name.js
--- a/old/name.js
+++ b/new/name.js
@@ -1,2 +1,2 @@
-export const LIMIT_MAX = 1;
+export const LIMIT_MAX = 2;
 export function helperThing() {}
`;

const refs = { base_sha: 'b'.repeat(40), start_sha: 's'.repeat(40), head_sha: 'h'.repeat(40) };

test('parseDiff maps added and context lines, renames', () => {
  const files = parseDiff(DIFF);
  assert.equal(files.length, 2);
  const p = files[0];
  assert.equal(p.newLines.get(10).type, 'context');
  assert.equal(p.newLines.get(10).oldLine, 10);
  assert.equal(p.newLines.get(11).type, 'added');
  assert.equal(p.newLines.get(11).text, '  return items.slice(start, start + size - 1);');
  assert.equal(p.newLines.get(12).type, 'added');
  assert.equal(p.newLines.get(13).type, 'context');
  assert.equal(p.newLines.get(13).oldLine, 12);
  assert.equal(files[1].oldPath, 'old/name.js');
  assert.equal(files[1].newPath, 'new/name.js');
});

test('positionFor: added line has new_line only, context has both, outside diff is null', () => {
  const files = parseDiff(DIFF);
  const added = positionFor(files, 'src/page.js', 11, refs);
  assert.deepEqual(added, { position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha, old_path: 'src/page.js', new_path: 'src/page.js', new_line: 11 });
  const ctx = positionFor(files, 'src/page.js', 13, refs);
  assert.equal(ctx.old_line, 12);
  assert.equal(positionFor(files, 'src/page.js', 40, refs), null);
  assert.equal(positionFor(files, 'nope.js', 1, refs), null);
  assert.equal(positionFor(files, 'new/name.js', 1, refs).old_path, 'old/name.js');
});

test('nearestDiffLine prefers added lines within slack', () => {
  const files = parseDiff(DIFF);
  assert.equal(nearestDiffLine(files, 'src/page.js', 11, 3), 11);
  assert.equal(nearestDiffLine(files, 'src/page.js', 14, 3), 12);
  assert.equal(nearestDiffLine(files, 'src/page.js', 30, 3), null);
});

test('planInlineComments anchors findings in the diff, keeps fps for all, skips forced', () => {
  const files = parseDiff(DIFF);
  const c = cfg();
  const review = normalizeReview(
    {
      match: { items: [], explanation: '' },
      regression: { risk: 'none', explanation: '', affected: [] },
      blockers: [{ title: 'slice end off by one', file: 'src/page.js', line: 11, detail: 'd', suggestion: 's', diff: '-a\n+b' }],
      potentialBugs: [{ title: 'far away', file: 'src/page.js', line: 80, detail: 'd', suggestion: 's', diff: '' }],
      recommendations: [{ text: 'bump the limit doc', file: 'new/name.js', line: 1, diff: '' }],
    },
    { items: [] },
  );
  review.blockers.push({ title: '`QES-1` is not addressed', file: '', line: 0, detail: '', suggestion: '', diff: '', forced: true });
  const job = { base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha };
  const plan = planInlineComments({ review, files, job, cfg: c });
  assert.equal(plan.comments.length, 2);
  assert.equal(plan.fps.length, 3);
  assert.match(plan.comments[0].body, /^\*\*Blocker: slice end off by one\*\*/);
  assert.match(plan.comments[0].body, /```diff\n-a\n\+b\n```/);
  assert.match(plan.comments[0].body, /<!-- ai-review fp=[0-9a-f]{12} -->/);
  assert.equal(plan.comments[1].position.new_path, 'new/name.js');
  assert.match(plan.comments[1].body, /^\*\*Recommendation\*\*\n\nbump the limit doc/);
  // A second blocker on the same line doesn't open a second thread.
  const twice = structuredClone(review);
  twice.blockers.push({ ...twice.blockers[0], title: 'same line, other words' });
  assert.equal(planInlineComments({ review: twice, files, job, cfg: c }).comments.filter((x) => x.kind === 'blockers').length, 1);
  // Reworded finding on the same line keeps the same thread.
  const reworded = structuredClone(review);
  reworded.blockers[0].title = 'Off-by-one in slice end';
  assert.equal(planInlineComments({ review: reworded, files, job, cfg: c }).comments[0].fp, plan.comments[0].fp);
  const off = planInlineComments({ review, files, job, cfg: cfg('defaults:\n  inline:\n    enabled: false\n') });
  assert.equal(off.comments.length, 0);
});

test('changedSymbols finds declarations in hunks', () => {
  const syms = changedSymbols(parseDiff(DIFF), 10);
  assert.ok(syms.includes('pageOf'));
  assert.ok(syms.includes('LIMIT_MAX'));
  // Unchanged context lines are not changed symbols.
  assert.ok(!syms.includes('helperThing'));
});

test('gatherRelated finds uses outside the change, importers and siblings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'lib'), { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.local');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(src, 'lib', 'page.js'), 'export function pageOf(a, p, s) {\n  return a.slice((p - 1) * s, p * s);\n}\n');
  fs.writeFileSync(path.join(src, 'lib', 'other.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(src, 'use.js'), "import { pageOf } from './lib/page.js';\nconsole.log(pageOf([1], 1, 1));\n");
  g('add', '.');
  g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(src, 'lib', 'page.js'), 'export function pageOf(a, p, s) {\n  return a.slice(p * s, p * s + s);\n}\n');
  g('commit', '-qam', 'head');
  const head = g('rev-parse', 'HEAD');
  g('update-ref', 'refs/merge-requests/1/head', head);
  const repo = new Repo({ reposDir: path.join(root, 'repos'), projectId: 9, projectPath: 'x', gitlabUrl: 'x', token: '', extraConfig: [['protocol.file.allow', 'always']] });
  repo.remote = src;
  await repo.fetchShas({ mrIid: 1, targetBranch: 'main', baseSha: base, headSha: head });
  const files = parseDiff(await repo.diff(base, head));
  const rel = await gatherRelated({ repo, headSha: head, files, cfg: cfg() });
  assert.ok(rel.symbols.includes('pageOf'));
  assert.match(rel.text, /Uses of `pageOf` outside the changed lines/);
  assert.match(rel.text, /use\.js:2:console\.log\(pageOf/);
  assert.match(rel.text, /Files importing `page`:\nuse\.js:1:/);
  assert.match(rel.text, /Sibling files in `lib\/`: `other\.js`/);
});
