import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, uninstall, status, detectAgents } from '../scripts/lib/install.mjs';

const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));
const codexFixture = fileURLToPath(new URL('./fixtures/codex.jsonl', import.meta.url));

function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-glob-'));
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { tmp, projectRoot, home, scriptPath: path.join(tmp, 'skill', 'convo-sync.mjs') };
}
const toml = (e) => path.join(e.home, '.codex', 'config.toml');

// ---- Codex uses `notify` in ~/.codex/config.toml (hooks did not fire in live tests) ----

test('codex install adds a top-level notify line before the first table, keeping the rest', () => {
  const e = env();
  fs.mkdirSync(path.dirname(toml(e)), { recursive: true });
  const original = '[tui]\nscreen_reader_detection_done = true\n\n[projects.\'c:\\x\']\ntrust_level = "trusted"\n';
  fs.writeFileSync(toml(e), original);
  const r = install({ agent: 'codex', ...e });
  assert.equal(r.file, toml(e));
  assert.equal(r.changed, true);
  const text = fs.readFileSync(toml(e), 'utf8');
  const notifyLine = text.split('\n').find((l) => l.startsWith('notify'));
  assert.deepEqual(JSON.parse(notifyLine.replace(/^notify\s*=\s*/, '')),
    ['node', e.scriptPath.split(path.sep).join('/'), 'sync', '--agent', 'codex']);
  assert.ok(text.indexOf('notify') < text.indexOf('[tui]'), 'notify must precede the first table');
  assert.ok(text.endsWith(original), 'existing content preserved');
  assert.ok(fs.existsSync(toml(e) + '.convo-sync.bak'));
  assert.equal(r.note, undefined);
});

test('codex install creates config.toml when missing and is idempotent', () => {
  const e = env();
  assert.equal(install({ agent: 'codex', ...e }).changed, true);
  assert.equal(install({ agent: 'codex', ...e }).changed, false);
  assert.equal(fs.readFileSync(toml(e), 'utf8').match(/^notify/gm).length, 1);
});

test('codex install leaves a foreign notify alone and explains', () => {
  const e = env();
  fs.mkdirSync(path.dirname(toml(e)), { recursive: true });
  fs.writeFileSync(toml(e), 'notify = ["python3", "/x/notify.py"]\n');
  const r = install({ agent: 'codex', ...e });
  assert.equal(r.changed, false);
  assert.match(r.note, /notify/);
  assert.equal(fs.readFileSync(toml(e), 'utf8'), 'notify = ["python3", "/x/notify.py"]\n');
});

test('codex uninstall removes only our notify line', () => {
  const e = env();
  fs.mkdirSync(path.dirname(toml(e)), { recursive: true });
  fs.writeFileSync(toml(e), '[tui]\na = 1\n');
  install({ agent: 'codex', ...e });
  assert.equal(uninstall({ agent: 'codex', ...e }).changed, true);
  assert.equal(fs.readFileSync(toml(e), 'utf8'), '[tui]\na = 1\n');
});

test('codex uninstall also cleans a legacy project .codex/hooks.json entry', () => {
  const e = env();
  const legacy = path.join(e.projectRoot, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /a/convo-sync.mjs sync --agent codex' }] }] } }));
  uninstall({ agent: 'codex', ...e });
  assert.ok(!fs.existsSync(legacy), 'a hook file left empty by uninstall is removed');
});

test('status reports codex from config.toml notify', () => {
  const e = env();
  install({ agent: 'codex', ...e });
  assert.equal(status(e).find((r) => r.agent === 'codex').installed, true);
});

// ---- Global by default; no project files ----

test('uninstall deletes a hook file that becomes empty', () => {
  const e = env();
  install({ agent: 'claude', scope: 'user', ...e });
  uninstall({ agent: 'claude', scope: 'user', ...e });
  assert.ok(!fs.existsSync(path.join(e.home, '.claude', 'settings.json')));
});

test('detectAgents lists only agents whose home folder exists', () => {
  const e = env();
  fs.mkdirSync(path.join(e.home, '.claude'));
  fs.mkdirSync(path.join(e.home, '.config', 'opencode'), { recursive: true });
  assert.deepEqual(detectAgents(e.home), ['claude', 'opencode']);
  fs.mkdirSync(path.join(e.home, '.gemini'));
  fs.mkdirSync(path.join(e.home, '.codex'));
  assert.deepEqual(detectAgents(e.home), ['claude', 'codex', 'antigravity', 'opencode']);
});

function cliEnv(home) {
  return { ...process.env, HOME: home, USERPROFILE: home };
}

test('CLI install with no flags installs globally for detected agents and leaves the project untouched', () => {
  const e = env();
  fs.mkdirSync(path.join(e.projectRoot, '.git'));
  fs.mkdirSync(path.join(e.home, '.claude'));
  fs.mkdirSync(path.join(e.home, '.codex'));
  const r = spawnSync(process.execPath, [cli, 'install'], { cwd: e.projectRoot, env: cliEnv(e.home), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(e.home, '.claude', 'settings.json')));
  assert.match(fs.readFileSync(path.join(e.home, '.codex', 'config.toml'), 'utf8'), /^notify = /m);
  assert.ok(!fs.existsSync(path.join(e.home, '.gemini')), 'undetected agents are skipped');
  assert.deepEqual(fs.readdirSync(e.projectRoot), ['.git'], 'project has no new files');
});

// ---- Codex notify payload arrives as the last argv ----

test('CLI sync --agent codex reads the notify JSON from argv and finds the rollout', () => {
  const e = env();
  const codexHome = path.join(e.tmp, 'codexhome');
  const day = path.join(codexHome, 'sessions', '2026', '10', '26');
  fs.mkdirSync(day, { recursive: true });
  const id = '01a176cc-9ca5-7072-9924-51f26b560e3b';
  fs.copyFileSync(codexFixture, path.join(day, `rollout-2026-10-26T11-31-23-${id}.jsonl`));
  fs.mkdirSync(path.join(e.projectRoot, '.git'));
  const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': id, cwd: e.projectRoot, 'last-assistant-message': 'x' });
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'codex', payload],
    { env: { ...process.env, CODEX_HOME: codexHome }, encoding: 'utf8', input: '' });
  assert.equal(r.status, 0);
  const notes = fs.readdirSync(path.join(e.projectRoot, '.agents', 'conversations'));
  assert.deepEqual(notes, ['2026-10-26_codex_01a176cc.md']);
});

// ---- OpenCode plugin works with the 1.x and 2.x client shapes ----

async function runPlugin(clientMessages) {
  const e = env();
  const marker = path.join(e.tmp, 'payload-copy.json');
  const probe = path.join(e.tmp, 'probe.mjs');
  // Stand-in for convo-sync.mjs: copy the payload file it is handed.
  fs.writeFileSync(probe, `import fs from 'node:fs'; const i = process.argv.indexOf('--payload-file'); fs.copyFileSync(process.argv[i + 1], ${JSON.stringify(marker)});`);
  const r = install({ agent: 'opencode', scope: 'project', ...e, scriptPath: probe });
  const mod = await import('file://' + r.file.split(path.sep).join('/'));
  const hooks = await mod.ConvoSync({ client: { session: { messages: clientMessages } }, directory: e.projectRoot });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_x' } } });
  for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await new Promise((res) => setTimeout(res, 100));
  return fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
}
const data = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }];

test('opencode plugin works with the 1.x client ({ path: { id } })', async () => {
  const got = await runPlugin(async (o) => (o?.path?.id === 'ses_x' ? { data } : { error: 'bad request' }));
  assert.deepEqual(got?.messages, data);
});

test('opencode plugin works with the 2.x client ({ sessionID })', async () => {
  const got = await runPlugin(async (o) => (o?.sessionID === 'ses_x' && !o.path ? { data } : { error: 'bad request' }));
  assert.deepEqual(got?.messages, data);
});
