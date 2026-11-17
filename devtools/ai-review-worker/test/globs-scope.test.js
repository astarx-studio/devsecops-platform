import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobList, matchesAny, targetBranchAllowed } from '../src/globs.js';
import { decideScope } from '../src/scope.js';
import { parseConfigText, resolveProject } from '../src/config.js';

test('parseGlobList trims, drops empties and trailing commas', () => {
  assert.deepEqual(parseGlobList(' develop, release/* ,,'), ['develop', 'release/*']);
  assert.deepEqual(parseGlobList(''), []);
  assert.deepEqual(parseGlobList(undefined), []);
});

test('* stays in one segment, ** crosses segments, names are exact', () => {
  assert.ok(matchesAny('release/1.2', ['release/*']));
  assert.ok(!matchesAny('release/1.2/hotfix', ['release/*']));
  assert.ok(matchesAny('release/1.2/hotfix', ['release/**']));
  assert.ok(matchesAny('develop', ['develop']));
  assert.ok(!matchesAny('develop-x', ['develop']));
  assert.ok(!matchesAny('Develop', ['develop']));
});

test('X-Review-Only header replaces the config target list', () => {
  const header = 'develop, release/*';
  assert.equal(targetBranchAllowed('develop', header, ['prod']).allowed, true);
  assert.equal(targetBranchAllowed('release/1.2', header, ['prod']).allowed, true);
  assert.equal(targetBranchAllowed('prod', header, ['prod']).allowed, false);
});

test('empty or missing header falls back to config, default reviews everything', () => {
  assert.equal(targetBranchAllowed('prod', '', ['develop']).allowed, false);
  assert.equal(targetBranchAllowed('prod', '  , ', ['develop']).allowed, false);
  assert.equal(targetBranchAllowed('feature/a/b', undefined, ['**']).allowed, true);
  assert.equal(targetBranchAllowed('anything/deep', null, []).allowed, true);
});

const job = (over = {}) => ({
  project_path: 'internal/qestor/qestor-web',
  source_branch: 'feature/QES-1',
  target_branch: 'develop',
  draft: false,
  labels: [],
  qestor_items: [],
  ...over,
});

test('scope reasons', () => {
  const file = parseConfigText('enabled_projects: ["internal/**"]\ndefaults:\n  scope:\n    skip_labels: [wip]\n');
  const cfg = resolveProject(file, 'internal/qestor/qestor-web');
  assert.equal(decideScope(file, cfg, job()).review, true);
  assert.match(decideScope(file, cfg, job({ project_path: 'other/x' })).reason, /enabled_projects/);
  assert.match(decideScope(file, cfg, job({ draft: true })).reason, /draft/);
  assert.match(decideScope(file, cfg, job({ labels: ['wip'] })).reason, /skip_labels/);
  assert.match(decideScope(file, cfg, job({ target_branch: 'prod', review_only: 'develop' })).reason, /X-Review-Only/);
});

test('require_qestor_items', () => {
  const file = parseConfigText('defaults:\n  scope:\n    require_qestor_items: true\n');
  const cfg = resolveProject(file, 'a/b');
  assert.match(decideScope(file, cfg, job()).reason, /Qestor/);
  assert.equal(decideScope(file, cfg, job({ qestor_items: [{ public_id: 'QES-1' }] })).review, true);
});
