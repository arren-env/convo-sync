import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));
// Never touch the real home folder: point HOME/USERPROFILE (and CODEX_HOME) at a temp dir.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-home-'));
for (const d of ['.claude', '.codex', '.gemini', '.config/opencode']) fs.mkdirSync(path.join(fakeHome, d), { recursive: true });
const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, CODEX_HOME: path.join(fakeHome, '.codex'), COPILOT_HOME: path.join(fakeHome, '.copilot') };
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env });

test('install --agent all --scope project writes every agent config at the git root', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.mkdirSync(path.join(proj, 'sub'));
  const r = run(['install', '--agent', 'all', '--scope', 'project'], path.join(proj, 'sub'));
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['.claude/settings.local.json', '.agents/hooks.json', '.opencode/plugins/convo-sync.js']) {
    assert.ok(fs.existsSync(path.join(proj, f)), f);
  }
  assert.match(r.stdout, /claude/);
  const st = run(['status'], proj);
  assert.equal(st.status, 0);
  assert.match(st.stdout, /claude\s+project\s+installed/);
  const un = run(['uninstall', '--agent', 'claude', '--scope', 'project'], proj);
  assert.equal(un.status, 0);
  assert.match(run(['status'], proj).stdout, /claude\s+project\s+not installed/);
});

test('install rejects an unknown agent with exit 1', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-'));
  const r = run(['install', '--agent', 'nope'], proj);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown agent/);
});
