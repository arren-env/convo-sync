import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toMarkdown, fileBaseName } from '../scripts/lib/render.mjs';
import { parseNote, buildContext } from '../scripts/lib/context.mjs';

const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));
const opts = { includeThinking: false, includeTools: false };

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ctx-'));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

function session(agent, id, updated, messages) {
  return { agent, sessionId: id, cwd: '/p', startedAt: new Date(updated), updatedAt: new Date(updated), messages };
}

function writeNote(root, s, dir = '.agents/conversations') {
  const out = path.join(root, dir);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${fileBaseName(s)}.md`);
  fs.writeFileSync(file, toMarkdown(s, opts));
  return file;
}

const msgs = (n, size = 20) => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  text: `${i % 2 ? 'answer' : 'question'} ${i} ${'x'.repeat(size)}`,
}));

test('parseNote reads frontmatter and messages from a rendered note', () => {
  const s = session('codex', 'abc12345', '2026-11-05T10:00:00', [
    { role: 'user', text: 'Add a login page' },
    { role: 'assistant', text: 'Done.\n\n---\n\nIt uses a form.' },
    { role: 'user', text: 'thanks' },
  ]);
  const note = parseNote(toMarkdown(s, opts));
  assert.equal(note.agent, 'codex');
  assert.equal(note.sessionId, 'abc12345');
  assert.equal(note.title, 'Add a login page');
  assert.equal(note.messages.length, 3);
  assert.deepEqual(note.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(note.messages[1].text, 'Done.\n\n---\n\nIt uses a form.');
});

test('buildContext lists the newest conversations first, up to the limit', () => {
  const root = project();
  writeNote(root, session('claude', 'old11111', '2026-11-01T09:00:00', [{ role: 'user', text: 'oldest request' }]));
  writeNote(root, session('codex', 'new22222', '2026-11-05T09:00:00', msgs(2)));
  writeNote(root, session('antigravity', 'mid33333', '2026-11-03T09:00:00', msgs(2)));
  const out = buildContext({ projectRoot: root, limit: 2 });
  const iCodex = out.indexOf('codex');
  const iAg = out.indexOf('antigravity');
  assert.ok(iCodex >= 0 && iAg > iCodex, out);
  // The third note is beyond the limit: listed by file only, its messages not included.
  assert.match(out, /2026-11-01_claude_old11111\.md/);
  assert.ok(!out.includes('oldest request\n'), 'messages of notes beyond the limit are not included');
});

test('buildContext keeps the first request and the latest messages when over budget', () => {
  const root = project();
  writeNote(root, session('codex', 'big44444', '2026-11-05T09:00:00', msgs(40, 300)));
  const out = buildContext({ projectRoot: root, limit: 1, maxChars: 3000 });
  assert.ok(out.length <= 3500, `length ${out.length}`);
  assert.match(out, /question 0 /, 'first user request kept');
  assert.match(out, /answer 39 /, 'last message kept');
  assert.match(out, /earlier messages omitted/);
  assert.ok(!out.includes('question 10 '), 'middle dropped');
});

test('buildContext reads the folder set by outputDir in .convo-sync.json', () => {
  const root = project();
  fs.writeFileSync(path.join(root, '.convo-sync.json'), JSON.stringify({ outputDir: 'notes/chats' }));
  writeNote(root, session('claude', 'cfg55555', '2026-11-05T09:00:00', msgs(2)), 'notes/chats');
  assert.match(buildContext({ projectRoot: root }), /question 0/);
});

test('buildContext says so when there are no notes', () => {
  const out = buildContext({ projectRoot: project() });
  assert.match(out, /No saved conversations/);
});

test('buildContext ignores non-note files in the folder', () => {
  const root = project();
  writeNote(root, session('claude', 'ok666666', '2026-11-05T09:00:00', msgs(2)));
  fs.writeFileSync(path.join(root, '.agents/conversations/README.md'), '# not a note\n');
  fs.writeFileSync(path.join(root, '.agents/conversations/x.jsonl'), '{}\n');
  const out = buildContext({ projectRoot: root });
  assert.match(out, /question 0/);
  assert.ok(!out.includes('not a note'));
});

test('cli context prints the latest conversation from a subfolder of the project', () => {
  const root = project();
  writeNote(root, session('codex', 'cli77777', '2026-11-05T09:00:00', msgs(4)));
  fs.mkdirSync(path.join(root, 'src'));
  const r = spawnSync(process.execPath, [cli, 'context'], { cwd: path.join(root, 'src'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /codex/);
  assert.match(r.stdout, /answer 3 /);
});
