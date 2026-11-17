import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Repo, safeRelPath, assertReadableEntry, runGit } from '../src/git.js';
import { runReads } from '../src/loop.js';
import { parseConfigText, resolveProject } from '../src/config.js';

test('safeRelPath refuses escapes', () => {
  assert.equal(safeRelPath('./src//a.ts'), 'src/a.ts');
  assert.equal(safeRelPath('src\\a.ts'), 'src/a.ts');
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', '.git/config', '', 'a\0b']) {
    assert.throws(() => safeRelPath(bad), undefined, bad);
  }
});

test('assertReadableEntry refuses symlinks and trees', () => {
  assert.throws(() => assertReadableEntry({ mode: '120000', type: 'blob' }, 'l'), /symlink/);
  assert.throws(() => assertReadableEntry({ mode: '040000', type: 'tree' }, 'd'), /not a file/);
  assert.throws(() => assertReadableEntry(null, 'x'), /no such file/);
  assertReadableEntry({ mode: '100644', type: 'blob' }, 'f');
});

// Builds a real source repo, then a bare mirror that fetches it, the same way
// the worker fetches GitLab (only the remote URL differs).
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  const g = (...a) => execFileSync('git', a, { cwd: src, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.local');
  g('config', 'user.name', 't');
  g('config', 'core.symlinks', 'true');
  fs.mkdirSync(path.join(src, 'src'));
  fs.writeFileSync(path.join(src, 'src', 'a.js'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  g('add', '.');
  g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(src, 'src', 'a.js'), 'function findMe() { return 1 }\n');
  // A symlink pointing outside the repo, added as a git object so this works on Windows too.
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: src, input: '/etc/passwd' }).toString().trim();
  g('update-index', '--add', '--cacheinfo', `120000,${blob},evil`);
  g('add', 'src/a.js');
  g('commit', '-qm', 'head');
  const head = g('rev-parse', 'HEAD');
  g('update-ref', 'refs/merge-requests/7/head', head);
  return { root, src, base, head };
}

test('Repo fetches MR refs into a mirror and reads safely', async () => {
  const { root, src, base, head } = makeRepo();
  const repo = new Repo({ reposDir: path.join(root, 'repos'), projectId: 1, projectPath: 'unused', gitlabUrl: 'x', token: '', extraConfig: [['protocol.file.allow', 'always']] });
  repo.remote = src;
  await repo.fetchShas({ mrIid: 7, targetBranch: 'main', baseSha: base, headSha: head });
  assert.ok(await repo.hasCommit(head));
  assert.deepEqual((await repo.changedFiles(base, head)).sort(), ['evil', 'src/a.js']);
  assert.match(await repo.diff(base, head), /findMe/);

  const cfg = resolveProject(parseConfigText('{}'), 'a/b');
  const out = await runReads(
    [
      { kind: 'file', path: 'src/a.js', start_line: 29, end_line: 31 },
      { kind: 'file', path: 'evil' },
      { kind: 'file', path: '../../etc/passwd' },
      { kind: 'grep', pattern: 'findMe\\(', path_glob: 'src/**' },
      { kind: 'qestor', ids: ['QES-1'] },
    ],
    { repo, headSha: head, cfg, qestorLookup: async (ids) => ids.map((id) => ({ public_id: id, title: 'T' })) },
  );
  assert.match(out, /31: function findMe/);
  assert.match(out, /symlink refused: evil/);
  assert.match(out, /leaves the repository/);
  assert.match(out, /src\/a\.js:31:function findMe/);
  assert.match(out, /QES-1: T/);
  assert.equal(await repo.lineCount(head, 'src/a.js'), 32);
  const commits = await repo.commitsWithFiles(base, head);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'head');
  assert.deepEqual(commits[0].files.sort(), ['evil', 'src/a.js']);
});

test('token never lands in the mirror config', async () => {
  const { root, src, base, head } = makeRepo();
  const repo = new Repo({ reposDir: path.join(root, 'repos'), projectId: 2, projectPath: 'unused', gitlabUrl: 'x', token: 'glpat-secret', extraConfig: [['protocol.file.allow', 'always']] });
  repo.remote = src;
  await repo.fetchShas({ mrIid: 7, targetBranch: 'main', baseSha: base, headSha: head });
  const config = fs.readFileSync(path.join(repo.dir, 'config'), 'utf8');
  assert.ok(!config.includes('secret'));
  assert.ok(!config.includes('Authorization'));
  await assert.rejects(runGit(['fetch', 'https://127.0.0.1:1/nope.git'], { cwd: repo.dir, token: 'glpat-secret', timeoutMs: 5000 }), (e) => !e.message.includes('glpat'));
});
