import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCursor, parseCursorTimestamp, locateCursor, findCursorTranscript, cursorClient } from '../scripts/lib/adapters/cursor.mjs';
import { syncSession } from '../scripts/lib/sync.mjs';
import { install, uninstall, status, detectAgents, targetFile } from '../scripts/lib/install.mjs';

const fixture = fileURLToPath(new URL('./fixtures/cursor.jsonl', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));
const SID = 'c0ffee00-0000-4000-8000-000000000001';

function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cur-'));
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { tmp, projectRoot, home, scriptPath: path.join(tmp, 'skill', 'convo-sync.mjs') };
}

/** Lay the fixture out the way Cursor does: <cursorHome>/projects/<slug>/agent-transcripts/<id>/<id>.jsonl */
function placeTranscript(cursorHome, id = SID) {
  const dir = path.join(cursorHome, 'projects', 'c-work-demo', 'agent-transcripts', id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.copyFileSync(fixture, file);
  return file;
}

// ---- parsing ----

test('parseCursorTimestamp reads Cursor\'s local time with its UTC offset', () => {
  assert.equal(parseCursorTimestamp('Friday, Nov 6, 2026, 11:18 AM (UTC+5:30)').toISOString(), '2026-11-06T05:48:00.000Z');
  assert.equal(parseCursorTimestamp('Friday, Nov 6, 2026, 12:05 AM (UTC-8)').toISOString(), '2026-11-06T08:05:00.000Z');
  assert.equal(parseCursorTimestamp('Friday, Nov 6, 2026, 12:30 PM (UTC)').toISOString(), '2026-11-06T12:30:00.000Z');
  assert.equal(parseCursorTimestamp('not a date'), null);
});

test('parseCursor reads the user query and merges assistant lines per turn', () => {
  const s = parseCursor(fs.readFileSync(fixture, 'utf8'), { sessionId: SID, cwd: '/work' });
  assert.equal(s.agent, 'cursor');
  assert.equal(s.sessionId, SID);
  assert.equal(s.cwd, '/work');
  assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [
    ['user', 'Add a dark mode toggle'],
    ['assistant', 'Checking the header component first.\n\nAdded a ThemeToggle to the header.'],
    ['user', 'Persist the choice'],
    ['assistant', 'Saved it to localStorage.'],
  ]);
  assert.deepEqual(s.messages[1].tools, ['Read']);
});

test('parseCursor takes start and last-turn times from the <timestamp> tags', () => {
  const s = parseCursor(fs.readFileSync(fixture, 'utf8'));
  assert.equal(s.startedAt.toISOString(), '2026-11-06T05:48:00.000Z');
  assert.equal(s.updatedAt.toISOString(), '2026-11-06T07:35:00.000Z');
});

test('parseCursor drops Cursor\'s injected context tags from user text', () => {
  const s = parseCursor(fs.readFileSync(fixture, 'utf8'));
  assert.ok(!s.messages.some((m) => /runtime_info|timestamp|shell: pwsh/.test(m.text)));
});

test('locateCursor reads the stop payload and fixes /c:/ style roots', () => {
  assert.deepEqual(
    locateCursor({ conversation_id: 'a', transcript_path: '/t.jsonl', workspace_roots: ['/c:/Projects/demo'] }),
    { sessionId: 'a', transcriptPath: '/t.jsonl', cwd: 'c:/Projects/demo' },
  );
  assert.deepEqual(locateCursor({ conversation_id: 'b', transcript_path: null, workspace_roots: [] }), { sessionId: 'b', transcriptPath: null, cwd: null });
});

test('findCursorTranscript searches every project folder and rejects unsafe ids', () => {
  const e = env();
  const cursorHome = path.join(e.home, '.cursor');
  const file = placeTranscript(cursorHome);
  assert.equal(findCursorTranscript(SID, cursorHome), file);
  assert.equal(findCursorTranscript('missing', cursorHome), null);
  assert.equal(findCursorTranscript('../escape', cursorHome), null);
});

test('cursorClient is cli when ~/.cursor/chats has the conversation, else editor', () => {
  const e = env();
  const cursorHome = path.join(e.home, '.cursor');
  const file = placeTranscript(cursorHome);
  assert.equal(cursorClient(file), 'editor');
  fs.mkdirSync(path.join(cursorHome, 'chats', 'abc123', SID), { recursive: true });
  assert.equal(cursorClient(file), 'cli');
});

// ---- sync ----

test('syncSession writes a cursor note from a stop payload', async () => {
  const e = env();
  const transcript = placeTranscript(path.join(e.home, '.cursor'));
  const { mdPath } = await syncSession({ agent: 'cursor', payload: { conversation_id: SID, transcript_path: transcript, workspace_roots: [e.projectRoot] } });
  assert.ok(mdPath.startsWith(path.join(e.projectRoot, '.agents', 'conversations')));
  assert.match(path.basename(mdPath), /^2026-11-06_\d{4}_cursor_c0ffee00\.md$/);
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.match(md, /client: editor/);
  assert.match(md, /Saved it to localStorage\./);
});

test('syncSession finds the transcript by conversation id when transcript_path is null', async () => {
  const e = env();
  const cursorHome = path.join(e.home, '.cursor');
  placeTranscript(cursorHome);
  const saved = process.env.USERPROFILE, savedHome = process.env.HOME;
  process.env.USERPROFILE = e.home; process.env.HOME = e.home;
  try {
    const { mdPath } = await syncSession({ agent: 'cursor', payload: { conversation_id: SID, transcript_path: null, workspace_roots: [e.projectRoot] } });
    assert.ok(mdPath && fs.existsSync(mdPath));
  } finally {
    process.env.USERPROFILE = saved; process.env.HOME = savedHome;
  }
});

test('syncSession writes nothing without a workspace root (user hooks run from ~/.cursor)', async () => {
  const e = env();
  const transcript = placeTranscript(path.join(e.home, '.cursor'));
  const { mdPath } = await syncSession({ agent: 'cursor', payload: { conversation_id: SID, transcript_path: transcript, workspace_roots: [] } });
  assert.equal(mdPath, null);
});

test('CLI sync --agent cursor reads the hook payload from stdin and prints {}', () => {
  const e = env();
  const transcript = placeTranscript(path.join(e.home, '.cursor'));
  const payload = JSON.stringify({ hook_event_name: 'stop', status: 'completed', conversation_id: SID, transcript_path: transcript, workspace_roots: [e.projectRoot] });
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'cursor'], { input: payload, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
  const notes = fs.readdirSync(path.join(e.projectRoot, '.agents', 'conversations'));
  assert.ok(notes.some((n) => n.includes('_cursor_')), notes.join());
});

// ---- install: a stop hook merged into .cursor/hooks.json ----

test('cursor user install adds a stop hook to ~/.cursor/hooks.json', () => {
  const e = env();
  const r = install({ agent: 'cursor', scope: 'user', ...e });
  assert.equal(r.changed, true);
  assert.equal(r.file, path.join(e.home, '.cursor', 'hooks.json'));
  const cfg = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  assert.equal(cfg.version, 1);
  assert.equal(cfg.hooks.stop.length, 1);
  assert.match(cfg.hooks.stop[0].command, /^node .*convo-sync\.mjs sync --agent cursor$/);
  assert.equal(install({ agent: 'cursor', scope: 'user', ...e }).changed, false, 'idempotent');
});

test('cursor project install targets .cursor/hooks.json', () => {
  const e = env();
  assert.equal(targetFile('cursor', 'project', e.projectRoot, e.home), path.join(e.projectRoot, '.cursor', 'hooks.json'));
});

test('cursor install keeps the user\'s own hooks, and uninstall leaves them', () => {
  const e = env();
  const file = path.join(e.home, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mine = { version: 1, hooks: { stop: [{ command: 'echo mine' }], afterFileEdit: [{ command: 'fmt' }] } };
  fs.writeFileSync(file, JSON.stringify(mine));
  install({ agent: 'cursor', scope: 'user', ...e });
  let cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.hooks.stop.length, 2);
  assert.deepEqual(cfg.hooks.afterFileEdit, [{ command: 'fmt' }]);
  assert.equal(uninstall({ agent: 'cursor', scope: 'user', ...e }).changed, true);
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(cfg, mine);
});

test('cursor uninstall removes a hooks file that only held our hook; status follows', () => {
  const e = env();
  install({ agent: 'cursor', scope: 'user', ...e });
  const row = () => status({ projectRoot: e.projectRoot, home: e.home }).find((r) => r.agent === 'cursor' && r.scope === 'user');
  assert.equal(row().installed, true);
  uninstall({ agent: 'cursor', scope: 'user', ...e });
  assert.ok(!fs.existsSync(path.join(e.home, '.cursor', 'hooks.json')));
  assert.equal(row().installed, false);
});

test('detectAgents includes cursor when ~/.cursor exists', () => {
  const e = env();
  assert.ok(!detectAgents(e.home).includes('cursor'));
  fs.mkdirSync(path.join(e.home, '.cursor'));
  assert.ok(detectAgents(e.home).includes('cursor'));
});
