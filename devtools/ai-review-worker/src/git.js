import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The repo under review is hostile input. Nothing is checked out and no repo
// code runs: files are read straight from git objects at head_sha, so hooks,
// filters, LFS smudge and symlinks can't touch the worker's filesystem.

const SAFE_CONFIG = [
  ['core.hooksPath', '/dev/null'],
  ['core.fsmonitor', 'false'],
  ['protocol.file.allow', 'never'],
  ['protocol.ext.allow', 'never'],
  ['submodule.recurse', 'false'],
  ['fetch.recurseSubmodules', 'false'],
  ['diff.external', ''],
  ['core.pager', 'cat'],
  ['credential.helper', ''],
];

function gitEnv(token, extraConfig = []) {
  const pairs = [...SAFE_CONFIG, ...extraConfig];
  // Auth lives only in this process's env for the duration of the command;
  // it is never written into the mirror's config.
  if (token) pairs.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`oauth2:${token}`).toString('base64')}`]);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? '/tmp',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: String(pairs.length),
  };
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

export function runGit(args, { cwd, token, extraConfig, timeoutMs = 120000, maxBuffer = 64 * 1024 * 1024, allowExit = [] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(token, extraConfig), timeout: timeoutMs, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !(typeof err.code === 'number' && allowExit.includes(err.code))) {
        const msg = String(stderr || err.message).replace(/Authorization: Basic \S+/g, 'Authorization: ***');
        reject(new Error(`git ${args[0]} failed: ${msg.trim()}`));
        return;
      }
      resolve({ stdout: String(stdout), code: err ? err.code : 0 });
    });
  });
}

export class Repo {
  // extraConfig is for tests (a local file remote); production passes none.
  constructor({ reposDir, projectId, projectPath, gitlabUrl, token, extraConfig = [] }) {
    this.dir = path.join(reposDir, 'mirrors', `${Number(projectId)}.git`);
    this.remote = `${gitlabUrl.replace(/\/$/, '')}/${projectPath}.git`;
    this.token = token;
    this.extraConfig = extraConfig;
  }

  git(args, opts = {}) {
    return runGit(args, { cwd: this.dir, token: this.token, extraConfig: this.extraConfig, ...opts });
  }

  async ensureMirror() {
    if (!fs.existsSync(path.join(this.dir, 'HEAD'))) {
      fs.mkdirSync(this.dir, { recursive: true });
      await runGit(['init', '--bare', '--quiet', this.dir], {});
    }
    await this.git(['remote', 'remove', 'origin'], { allowExit: [2, 128] }).catch(() => {});
    await this.git(['remote', 'add', 'origin', this.remote]);
  }

  async hasCommit(sha) {
    const r = await this.git(['cat-file', '-e', `${sha}^{commit}`], { allowExit: [1, 128] });
    return r.code === 0;
  }

  // Fetches the MR head ref and the target branch; falls back to the SHAs.
  async fetchShas({ mrIid, targetBranch, baseSha, headSha }) {
    await this.ensureMirror();
    const refs = [`+refs/merge-requests/${Number(mrIid)}/head:refs/mr/${Number(mrIid)}`];
    if (targetBranch) refs.push(`+refs/heads/${targetBranch}:refs/target/${targetBranch}`);
    await this.git(['fetch', '--no-tags', '--prune', 'origin', ...refs], { timeoutMs: 300000 });
    for (const sha of [baseSha, headSha]) {
      if (!(await this.hasCommit(sha))) {
        await this.git(['fetch', '--no-tags', 'origin', sha], { timeoutMs: 300000 });
      }
      if (!(await this.hasCommit(sha))) throw new Error(`commit ${sha} not found after fetch`);
    }
  }

  // Baseline mode for related repos: one branch at a known head.
  async fetchBranch(ref, sha) {
    await this.ensureMirror();
    await this.git(['fetch', '--no-tags', 'origin', `+refs/heads/${ref}:refs/related/${ref}`], { timeoutMs: 300000 });
    if (!(await this.hasCommit(sha))) await this.git(['fetch', '--no-tags', 'origin', sha], { timeoutMs: 300000 });
    if (!(await this.hasCommit(sha))) throw new Error(`commit ${sha} not found after fetch`);
  }

  // Non-merge commits in base..head with the files each touched:
  // [{ sha, subject, files: [] }], oldest first.
  async commitsWithFiles(baseSha, headSha, max = 200) {
    const r = await this.git(['log', '--no-merges', '--reverse', `--max-count=${max}`, '--format=%x1e%h%x1f%s', '--name-only', `${baseSha}..${headSha}`]);
    return r.stdout
      .split('\x1e')
      .filter((c) => c.trim())
      .map((c) => {
        const [head, ...rest] = c.split('\n');
        const [sha, subject] = head.split('\x1f');
        return { sha, subject: subject ?? '', files: rest.map((l) => l.trim()).filter(Boolean) };
      });
  }

  async diffStat(baseSha, headSha) {
    const r = await this.git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--stat=200', baseSha, headSha]);
    return r.stdout;
  }

  async changedFiles(baseSha, headSha) {
    const r = await this.git(['diff', '--no-color', '--no-ext-diff', '--name-only', '-z', baseSha, headSha]);
    return r.stdout.split('\0').filter(Boolean);
  }

  async diff(baseSha, headSha, excludeGlobs = []) {
    const pathspec = ['.', ...excludeGlobs.map((g) => `:(exclude,glob)${g}`)];
    const r = await this.git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U3', baseSha, headSha, '--', ...pathspec]);
    return r.stdout;
  }

  // Returns { mode, type } for a tracked path at sha, or null.
  async entry(sha, relPath) {
    const r = await this.git(['ls-tree', '-z', sha, '--', relPath]);
    const line = r.stdout.split('\0')[0];
    if (!line) return null;
    const m = line.match(/^(\d+) (\w+) [0-9a-f]+\t(.*)$/);
    if (!m || m[3] !== relPath) return null;
    return { mode: m[1], type: m[2] };
  }

  async readLines(sha, relPath, startLine, endLine) {
    const r = await this.git(['cat-file', 'blob', `${sha}:${relPath}`], { maxBuffer: 16 * 1024 * 1024 });
    const lines = r.stdout.split('\n');
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return { total: lines.length, start: s, end: e, lines: lines.slice(s - 1, e) };
  }

  async lineCount(sha, relPath) {
    const r = await this.git(['cat-file', 'blob', `${sha}:${relPath}`], { maxBuffer: 16 * 1024 * 1024 });
    return r.stdout.split('\n').length;
  }

  // Names of entries directly inside `dir` at sha.
  async listDir(sha, dir) {
    const spec = dir === '.' || !dir ? sha : `${sha}:${dir}`;
    const r = await this.git(['ls-tree', '--name-only', '-z', spec]);
    return r.stdout.split('\0').filter(Boolean);
  }

  // `word` + `fixed` = whole-word literal match (portable, unlike \b in ERE).
  async grep(sha, pattern, pathGlob, maxHits, { word = false, fixed = false } = {}) {
    const args = ['grep', '-n', '-I', fixed ? '-F' : '-E', '--no-color'];
    if (word) args.push('-w');
    args.push('-e', pattern, sha, '--');
    args.push(pathGlob ? `:(glob)${pathGlob}` : '.');
    const r = await this.git(args, { allowExit: [1], timeoutMs: 30000 });
    const prefix = `${sha}:`;
    const hits = r.stdout.split('\n').filter(Boolean).map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l));
    return { hits: hits.slice(0, maxHits), total: hits.length };
  }
}

// Normalizes a model-supplied path. Rejects anything that could leave the repo.
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path is empty');
  const raw = p.trim().replace(/\\/g, '/');
  if (raw.includes('\0')) throw new Error('path has a NUL byte');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error(`absolute path refused: ${p}`);
  const parts = raw.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error(`path leaves the repository: ${p}`);
  if (parts[0] === '.git') throw new Error(`path inside .git refused: ${p}`);
  if (!parts.length) throw new Error('path is empty');
  return parts.join('/');
}

// Only plain blobs may be read: symlinks (120000) and submodules (160000) are refused.
export function assertReadableEntry(entry, relPath) {
  if (!entry) throw new Error(`no such file at head: ${relPath}`);
  if (entry.mode === '120000') throw new Error(`symlink refused: ${relPath}`);
  if (entry.type !== 'blob') throw new Error(`not a file: ${relPath}`);
}
