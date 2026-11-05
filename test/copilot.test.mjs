import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCopilot, locateCopilot, findCopilotEvents } from '../scripts/lib/adapters/copilot.mjs';
import { syncSession } from '../scripts/lib/sync.mjs';
import { install, uninstall, status, detectAgents, targetFile } from '../scripts/lib/install.mjs';

const fixture = fileURLToPath(new URL('./fixtures/copilot-events.jsonl', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));
const SID = '5f0c2a9e-1111-4bbb-8ccc-000000000001';

function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cop-'));
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { tmp, projectRoot, home, scriptPath: path.join(tmp, 'skill', 'convo-sync.mjs') };
}

// ---- parsing ~/.copilot/session-state/<id>/events.jsonl ----

test('parseCopilot reads user and assistant messages with session metadata', () => {
  const s = parseCopilot(fs.readFileSync(fixture, 'utf8'));
  assert.equal(s.agent, 'copilot');
  assert.equal(s.sessionId, SID);
  assert.equal(s.cwd, 'C:/work/demo');
  assert.equal(s.startedAt.toISOString(), '2026-11-05T06:00:00.000Z');
  assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [
    ['user', 'Add a dark mode toggle'],
    ['assistant', 'Added a ThemeToggle component and wired it into the header.'],
    ['user', 'Persist the choice'],
    ['assistant', 'Saved it to localStorage.'],
  ]);
});

test('parseCopilot keeps reasoning and tool names on the assistant message', () => {
  const [, first] = parseCopilot(fs.readFileSync(fixture, 'utf8')).messages;
  assert.equal(first.thinking, 'Look at the app shell first.');
  assert.deepEqual(first.tools, ['view']);
});

test('parseCopilot uses what the user typed, not the transformed prompt', () => {
  const s = parseCopilot(fs.readFileSync(fixture, 'utf8'));
  assert.ok(!s.messages.some((m) => m.text.includes('current_datetime')));
});

test('parseCopilot skips subagent messages', () => {
  const s = parseCopilot(fs.readFileSync(fixture, 'utf8'));
  assert.ok(!s.messages.some((m) => m.text.includes('Subagent note')));
});

test('locateCopilot accepts camelCase (agentStop) and snake_case (Stop) payloads', () => {
  assert.deepEqual(locateCopilot({ sessionId: 'a', transcriptPath: '/t', cwd: '/c' }), { sessionId: 'a', transcriptPath: '/t', cwd: '/c' });
  assert.deepEqual(locateCopilot({ session_id: 'b', transcript_path: '/u', cwd: '/d' }), { sessionId: 'b', transcriptPath: '/u', cwd: '/d' });
});

test('findCopilotEvents finds session-state/<id>/events.jsonl under the Copilot home', () => {
  const e = env();
  const dir = path.join(e.home, '.copilot', 'session-state', SID);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(fixture, path.join(dir, 'events.jsonl'));
  assert.equal(findCopilotEvents(SID, path.join(e.home, '.copilot')), path.join(dir, 'events.jsonl'));
  assert.equal(findCopilotEvents('missing', path.join(e.home, '.copilot')), null);
  assert.equal(findCopilotEvents('../escape', path.join(e.home, '.copilot')), null);
});

test('syncSession writes a copilot note from an agentStop payload', async () => {
  const e = env();
  const { mdPath } = await syncSession({ agent: 'copilot', payload: { sessionId: SID, transcriptPath: fixture, cwd: e.projectRoot } });
  assert.match(path.basename(mdPath), /_copilot_5f0c2a9e\.md$/);
  assert.ok(mdPath.startsWith(path.join(e.projectRoot, '.agents', 'conversations')));
  assert.match(fs.readFileSync(mdPath, 'utf8'), /Saved it to localStorage\./);
});

test('syncSession writes nothing when the transcript is not a Copilot events file', async () => {
  const e = env();
  const other = path.join(e.tmp, 'other.json');
  fs.writeFileSync(other, '{"turns":[{"text":"hi"}]}\n');
  const { mdPath } = await syncSession({ agent: 'copilot', payload: { session_id: 'zzz', transcript_path: other, cwd: e.projectRoot } });
  assert.equal(mdPath, null);
});

// ---- install: one hook file in ~/.copilot/hooks (CLI and VS Code share it) ----

test('copilot user install writes ~/.copilot/hooks/convo-sync.json with an agentStop hook', () => {
  const e = env();
  const r = install({ agent: 'copilot', scope: 'user', ...e });
  assert.equal(r.changed, true);
  assert.equal(r.file, path.join(e.home, '.copilot', 'hooks', 'convo-sync.json'));
  const cfg = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  assert.equal(cfg.version, 1);
  const [hook] = cfg.hooks.agentStop;
  assert.equal(hook.type, 'command');
  assert.match(hook.command, /^node .*convo-sync\.mjs sync --agent copilot$/);
  assert.equal(hook.timeoutSec, 15);
  assert.equal(install({ agent: 'copilot', scope: 'user', ...e }).changed, false, 'idempotent');
});

test('copilot project install writes .github/hooks/convo-sync.json', () => {
  const e = env();
  assert.equal(targetFile('copilot', 'project', e.projectRoot, e.home), path.join(e.projectRoot, '.github', 'hooks', 'convo-sync.json'));
  install({ agent: 'copilot', scope: 'project', ...e });
  assert.ok(fs.existsSync(path.join(e.projectRoot, '.github', 'hooks', 'convo-sync.json')));
});

test('copilot install leaves a foreign file of the same name alone', () => {
  const e = env();
  const file = path.join(e.home, '.copilot', 'hooks', 'convo-sync.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"version":1,"hooks":{"agentStop":[{"type":"command","command":"echo mine"}]}}');
  const r = install({ agent: 'copilot', scope: 'user', ...e });
  assert.equal(r.changed, false);
  assert.match(r.note, /left it untouched/);
  assert.match(fs.readFileSync(file, 'utf8'), /echo mine/);
});

test('copilot uninstall removes the file and status reflects it', () => {
  const e = env();
  install({ agent: 'copilot', scope: 'user', ...e });
  const row = () => status({ projectRoot: e.projectRoot, home: e.home }).find((r) => r.agent === 'copilot' && r.scope === 'user');
  assert.equal(row().installed, true);
  assert.equal(uninstall({ agent: 'copilot', scope: 'user', ...e }).changed, true);
  assert.ok(!fs.existsSync(path.join(e.home, '.copilot', 'hooks', 'convo-sync.json')));
  assert.equal(row().installed, false);
});

test('detectAgents includes copilot when ~/.copilot exists', () => {
  const e = env();
  const saved = process.env.COPILOT_HOME;
  delete process.env.COPILOT_HOME;
  try {
    assert.ok(!detectAgents(e.home).includes('copilot'));
    fs.mkdirSync(path.join(e.home, '.copilot'));
    assert.ok(detectAgents(e.home).includes('copilot'));
  } finally {
    if (saved !== undefined) process.env.COPILOT_HOME = saved;
  }
});

test('CLI sync --agent copilot reads the hook payload from stdin', () => {
  const e = env();
  const payload = JSON.stringify({ sessionId: SID, transcriptPath: fixture, cwd: e.projectRoot, stopReason: 'end_turn' });
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'copilot'], { input: payload, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  const notes = fs.readdirSync(path.join(e.projectRoot, '.agents', 'conversations'));
  assert.ok(notes.some((n) => n.includes('_copilot_')), notes.join());
});

test('copilot notes record whether the session came from the CLI or VS Code', async () => {
  for (const [clientName, expected] of [['github/cli', 'cli'], ['vscode-agent-host', 'vscode']]) {
    const e = env();
    const dir = path.join(e.tmp, 'session-state', SID);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(fixture, path.join(dir, 'events.jsonl'));
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${SID}\nclient_name: ${clientName}\nbranch: main\n`);
    const { mdPath } = await syncSession({ agent: 'copilot', payload: { sessionId: SID, transcriptPath: path.join(dir, 'events.jsonl'), cwd: e.projectRoot } });
    assert.match(fs.readFileSync(mdPath, 'utf8'), new RegExp(`^client: ${expected}$`, 'm'));
  }
});

test('copilot notes without workspace.yaml have no client line', async () => {
  const e = env();
  const { mdPath } = await syncSession({ agent: 'copilot', payload: { sessionId: SID, transcriptPath: fixture, cwd: e.projectRoot } });
  assert.doesNotMatch(fs.readFileSync(mdPath, 'utf8'), /^client:/m);
});
