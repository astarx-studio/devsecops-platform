import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConfigText, resolveProject, ConfigStore } from '../src/config.js';

const quiet = { info() {}, error() {} };

test('shipped review.yaml is valid', () => {
  const text = fs.readFileSync(new URL('../config/review.yaml', import.meta.url), 'utf8');
  const file = parseConfigText(text);
  assert.equal(file.defaults.model.context_tokens, 131072);
});

test('project overrides merge objects and replace lists', () => {
  const file = parseConfigText(`
defaults:
  approve:
    never_on_paths: [a]
projects:
  g/p:
    approve:
      require_no_potential_bugs: false
      never_on_paths: [b]
`);
  const cfg = resolveProject(file, 'g/p');
  assert.equal(cfg.approve.require_no_potential_bugs, false);
  assert.equal(cfg.approve.require_no_blockers, true);
  assert.deepEqual(cfg.approve.never_on_paths, ['b']);
  assert.deepEqual(resolveProject(file, 'x/y').approve.never_on_paths, ['a']);
});

test('unknown keys and bad values are rejected', () => {
  assert.throws(() => parseConfigText('defaults:\n  model:\n    contxt_tokens: 1\n'), /invalid/);
  assert.throws(() => parseConfigText('defaults:\n  model:\n    provider: nope\n'), /invalid/);
  assert.throws(() => parseConfigText('defaults:\n  model:\n    context_tokens: 4096\n    max_output_tokens: 3000\n'), /half/);
});

test('context larger than runner --ctx-size is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const runner = path.join(dir, 'llama-swap.yaml');
  fs.writeFileSync(runner, 'models:\n  bonsai:\n    cmd: llama-server -m x.gguf --ctx-size 8192 --port ${PORT}\n');
  const file = parseConfigText(`defaults:\n  model:\n    context_tokens: 16384\n    runner_config: ${JSON.stringify(runner)}\n`);
  assert.throws(() => resolveProject(file, 'a/b'), /larger than the runner/);
  const ok = parseConfigText(`defaults:\n  model:\n    context_tokens: 8192\n    runner_config: ${JSON.stringify(runner)}\n`);
  assert.equal(resolveProject(ok, 'a/b').model.context_tokens, 8192);
});

test('ConfigStore hot-reloads and keeps last good config on a bad edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const p = path.join(dir, 'review.yaml');
  fs.writeFileSync(p, 'defaults:\n  model:\n    model: one\n');
  const store = new ConfigStore(p, quiet);
  assert.equal(store.load().defaults.model.model, 'one');
  fs.writeFileSync(p, 'defaults:\n  model:\n    model: two\n');
  assert.equal(store.load().defaults.model.model, 'two');
  fs.writeFileSync(p, 'defaults:\n  model:\n    modle: three\n');
  assert.equal(store.load().defaults.model.model, 'two');
});

test('standard files cannot leave the config dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const p = path.join(dir, 'review.yaml');
  fs.writeFileSync(p, '{}');
  fs.writeFileSync(path.join(dir, 'standard.md'), 'rules');
  const store = new ConfigStore(p, quiet);
  assert.equal(store.readConfigFile('standard.md'), 'rules');
  assert.throws(() => store.readConfigFile('../etc/passwd'), /outside/);
});
