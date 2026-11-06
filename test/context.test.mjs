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
  const out = buildContext({ projectRoot: root, limit: 1, maxChars: 3000, full: true });
  assert.ok(out.length <= 3500, `length ${out.length}`);
  assert.match(out, /question 0 /, 'first user request kept');
  assert.match(out, /answer 39 /, 'last message kept');
  assert.match(out, /earlier messages omitted/);
  assert.ok(!out.includes('question 10 '), 'middle dropped');
  assert.match(out, /\(partial\)/);
});

test('buildContext marks a note shown in full so agents do not reopen it', () => {
  const root = project();
  writeNote(root, session('codex', 'small6666', '2026-11-05T09:00:00', msgs(2)));
  const out = buildContext({ projectRoot: root, full: true });
  assert.match(out, /\(complete, no need to open\)/);
  assert.ok(!out.includes('(partial)'));
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

test('parseNote reads the summary block and keeps messages intact', () => {
  const root = project();
  const file = writeNote(root, session('codex', 'sum77777', '2026-11-05T09:00:00', msgs(4)));
  const note = parseNote(fs.readFileSync(file, 'utf8'));
  assert.match(note.summary, /^\*\*Goal:\*\* question 0/);
  assert.equal(note.messages.length, 4);
  assert.equal(note.messages[0].text, `question 0 ${'x'.repeat(20)}`);
});

test('buildContext prints the summary block by default and not the messages', () => {
  const root = project();
  const file = writeNote(root, session('codex', 'sum88888', '2026-11-05T09:00:00', msgs(10)));
  const out = buildContext({ projectRoot: root });
  assert.match(out, /\*\*Goal:\*\* question 0/);
  assert.match(out, /\*\*Status:\*\* answer 9/);
  assert.ok(out.includes(file), 'file path shown');
  assert.ok(!out.includes('question 4 '), 'middle messages not printed');
});

test('buildContext with full: true prints the digest', () => {
  const root = project();
  writeNote(root, session('codex', 'sum99999', '2026-11-05T09:00:00', msgs(10)));
  const out = buildContext({ projectRoot: root, full: true });
  assert.match(out, /\*\*User:\*\* question 0/);
  assert.match(out, /question 4 /);
  assert.doesNotMatch(out, /\*\*Goal:\*\*/);
});

test('buildContext falls back to the digest for notes without a summary', () => {
  const root = project();
  const dir = path.join(root, '.agents/conversations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-04_claude_oldnote1.md'),
    '---\ntitle: "old"\nagent: claude\nupdated: 2026-11-04 10:00:00\n---\n\n## User\n\nold request\n\n---\n\n## Assistant\n\nold answer\n\n---\n');
  const out = buildContext({ projectRoot: root });
  assert.match(out, /\*\*User:\*\* old request/);
  assert.match(out, /\*\*Assistant:\*\* old answer/);
});

test('a message containing "## Summary" is not taken for the block', () => {
  const root = project();
  const dir = path.join(root, '.agents/conversations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-04_claude_oldnote2.md'),
    '---\ntitle: "old"\nagent: claude\n---\n\n## User\n\nwrite\n## Summary\nplease\n\n---\n\n## Assistant\n\ndone\n\n---\n');
  const note = parseNote(fs.readFileSync(path.join(dir, '2026-11-04_claude_oldnote2.md'), 'utf8'));
  assert.equal(note.summary, '');
  assert.equal(note.messages.length, 2);
});

test('cli context --full prints messages instead of summaries', () => {
  const root = project();
  writeNote(root, session('codex', 'clifull1', '2026-11-05T09:00:00', msgs(6)));
  const plain = spawnSync(process.execPath, [cli, 'context'], { cwd: root, encoding: 'utf8' });
  const full = spawnSync(process.execPath, [cli, 'context', '--full'], { cwd: root, encoding: 'utf8' });
  assert.match(plain.stdout, /\*\*Goal:\*\*/);
  assert.doesNotMatch(full.stdout, /\*\*Goal:\*\*/);
  assert.match(full.stdout, /\*\*User:\*\* question 0/);
});

test('a summary that contains the note separator does not corrupt the messages', () => {
  const root = project();
  const tricky = 'show me the format:\n---\n\n## User\n\nexample';
  const file = writeNote(root, session('codex', 'sep11111', '2026-11-05T09:00:00', [
    { role: 'user', text: tricky }, { role: 'assistant', text: 'done' },
  ]));
  const note = parseNote(fs.readFileSync(file, 'utf8'));
  // The summary stays whole and the first request is still the real one. (A message body that
  // contains the separator is still split in two; that predates the summary block.)
  assert.match(note.summary, /\*\*Status:\*\* done/);
  assert.ok(note.summary.includes('example'), note.summary);
  assert.equal(note.messages[0].role, 'user');
  assert.match(note.messages[0].text, /^show me the format:/);
});
