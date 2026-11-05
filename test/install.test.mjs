import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, status } from '../scripts/lib/install.mjs';

function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inst-'));
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const scriptPath = path.join(tmp, 'a b', 'convo-sync.mjs');
  return { projectRoot, home, scriptPath };
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const cmd = (scriptPath, agent) => `node "${scriptPath.split(path.sep).join("/")}" sync --agent ${agent}`;

test('claude project install writes a Stop hook with a quoted path', () => {
  const e = env();
  const r = install({ agent: 'claude', scope: 'project', ...e });
  assert.equal(r.file, path.join(e.projectRoot, '.claude', 'settings.local.json'));
  assert.equal(r.changed, true);
  assert.deepEqual(read(r.file), {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd(e.scriptPath, 'claude'), timeout: 30 }] }] },
  });
});

test('claude user scope goes to ~/.claude/settings.json', () => {
  const e = env();
  assert.equal(install({ agent: 'claude', scope: 'user', ...e }).file, path.join(e.home, '.claude', 'settings.json'));
});

test('existing settings and other Stop hooks are preserved; install is idempotent', () => {
  const e = env();
  const f = path.join(e.projectRoot, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const other = { hooks: [{ type: 'command', command: 'echo other' }] };
  fs.writeFileSync(f, '﻿' + JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [other] } }));
  install({ agent: 'claude', scope: 'project', ...e });
  const second = install({ agent: 'claude', scope: 'project', ...e });
  assert.equal(second.changed, false);
  const s = read(f);
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.equal(s.hooks.Stop.length, 2);
  assert.deepEqual(s.hooks.Stop[0], other);
  assert.ok(fs.existsSync(f + '.convo-sync.bak'));
});

test('uninstall removes only our entry', () => {
  const e = env();
  const f = path.join(e.projectRoot, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const other = { hooks: [{ type: 'command', command: 'echo other' }] };
  fs.writeFileSync(f, JSON.stringify({ hooks: { Stop: [other] } }));
  install({ agent: 'claude', scope: 'project', ...e });
  const r = uninstall({ agent: 'claude', scope: 'project', ...e });
  assert.equal(r.changed, true);
  assert.deepEqual(read(f), { hooks: { Stop: [other] } });
});

test('uninstall cleans up empty hook containers', () => {
  const e = env();
  install({ agent: 'claude', scope: 'project', ...e });
  uninstall({ agent: 'claude', scope: 'project', ...e });
  assert.ok(!fs.existsSync(path.join(e.projectRoot, '.claude', 'settings.local.json')), 'emptied hook file is removed');
});

test('invalid JSON is left untouched with a note', () => {
  const e = env();
  const f = path.join(e.projectRoot, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{ not json');
  const r = install({ agent: 'claude', scope: 'project', ...e });
  assert.equal(r.changed, false);
  assert.match(r.note, /not valid JSON/);
  assert.equal(fs.readFileSync(f, 'utf8'), '{ not json');
});



test('antigravity install writes a named group with PostInvocation', () => {
  const e = env();
  const r = install({ agent: 'antigravity', scope: 'project', ...e });
  assert.equal(r.file, path.join(e.projectRoot, '.agents', 'hooks.json'));
  assert.deepEqual(read(r.file), {
    'convo-sync': { enabled: true, PostInvocation: [{ type: 'command', command: cmd(e.scriptPath, 'antigravity'), timeout: 15 }] },
  });
  assert.equal(install({ agent: 'antigravity', scope: 'user', ...e }).file, path.join(e.home, '.gemini', 'config', 'hooks.json'));
});

test('antigravity uninstall keeps other groups', () => {
  const e = env();
  const f = path.join(e.projectRoot, '.agents', 'hooks.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ 'auto-convo-sync': { PostInvocation: [] } }));
  install({ agent: 'antigravity', scope: 'project', ...e });
  uninstall({ agent: 'antigravity', scope: 'project', ...e });
  assert.deepEqual(read(f), { 'auto-convo-sync': { PostInvocation: [] } });
});

test('status reports installed state per agent and scope', () => {
  const e = env();
  install({ agent: 'claude', scope: 'project', ...e });
  const rows = status({ projectRoot: e.projectRoot, home: e.home });
  const find = (agent, scope) => rows.find((r) => r.agent === agent && r.scope === scope);
  assert.equal(find('claude', 'project').installed, true);
  assert.equal(find('claude', 'user').installed, false);
  assert.equal(find('codex', 'user').installed, false);
  assert.equal(find('antigravity', 'project').installed, false);
});

test('hookCommand uses forward slashes so bash/sh/cmd all read the path the same', async () => {
  const { hookCommand } = await import('../scripts/lib/install.mjs');
  assert.equal(hookCommand('C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) + 'A B' + String.fromCharCode(92) + 'convo-sync.mjs', 'claude'),
    'node "C:/Users/A B/convo-sync.mjs" sync --agent claude');
});

test('hookCommand leaves a space-free path unquoted (Antigravity on Windows passes quotes through literally)', async () => {
  const { hookCommand } = await import('../scripts/lib/install.mjs');
  assert.equal(hookCommand('C:/Projects/Personal/convo-sync/scripts/convo-sync.mjs', 'antigravity'),
    'node C:/Projects/Personal/convo-sync/scripts/convo-sync.mjs sync --agent antigravity');
  assert.equal(hookCommand('/home/u/my skills/convo-sync.mjs', 'claude'), 'node "/home/u/my skills/convo-sync.mjs" sync --agent claude');
});

test('antigravity install warns when the script path contains spaces', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sp-'));
  const r = install({ agent: 'antigravity', scope: 'project', projectRoot: tmp, home: tmp, scriptPath: path.join(tmp, 'a b', 'convo-sync.mjs') });
  assert.match(r.note, /space/);
  const r2 = install({ agent: 'antigravity', scope: 'project', projectRoot: tmp, home: tmp, scriptPath: '/nospace/convo-sync.mjs' });
  assert.equal(r2.note, undefined);
});
