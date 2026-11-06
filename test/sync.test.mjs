import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncSession, projectRootFor } from '../scripts/lib/sync.mjs';

const fixture = fileURLToPath(new URL('./fixtures/claude.jsonl', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));

function setup(extraLine = '') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sync-'));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, fs.readFileSync(fixture, 'utf8') + extraLine);
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
  const payload = { transcript_path: transcript, session_id: '6ca14529-xx', cwd: path.join(proj, 'sub') };
  return { tmp, proj, payload };
}

test('projectRootFor walks up to the git root, else returns cwd', () => {
  const { proj } = setup();
  assert.equal(projectRootFor(path.join(proj, 'sub')), proj);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bare-'));
  assert.equal(projectRootFor(bare), bare);
});

test('writes markdown and raw copy into <root>/.agents/conversations', async () => {
  const { proj, payload } = setup();
  fs.writeFileSync(path.join(proj, '.convo-sync.json'), '{"copyRaw":true}');
  const { mdPath } = await syncSession({ agent: 'claude', payload });
  const dir = path.join(proj, '.agents', 'conversations');
  assert.equal(path.dirname(mdPath), dir);
  assert.match(path.basename(mdPath), /^\d{4}-\d{2}-\d{2}_claude_6ca14529\.md$/);
  assert.match(fs.readFileSync(mdPath, 'utf8'), /## User\n\nhi/);
  assert.ok(fs.existsSync(mdPath.replace(/\.md$/, '.jsonl')));
});

test('syncing twice keeps exactly one note', async () => {
  const { proj, payload } = setup();
  await syncSession({ agent: 'claude', payload });
  await syncSession({ agent: 'claude', payload });
  const files = fs.readdirSync(path.join(proj, '.agents', 'conversations'));
  assert.equal(files.filter((f) => f.endsWith('.md')).length, 1);
  assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0);
});

test('project config changes output dir; raw copy is off by default', async () => {
  const { proj, payload } = setup();
  fs.writeFileSync(path.join(proj, '.convo-sync.json'), '{"outputDir":"notes","copyRaw":false}');
  const { mdPath } = await syncSession({ agent: 'claude', payload });
  assert.equal(path.dirname(mdPath), path.join(proj, 'notes'));
  assert.ok(!fs.existsSync(mdPath.replace(/\.md$/, '.jsonl')));
});

test('secrets are redacted in both the note and the raw copy', async () => {
  const secret = 'sk-ant-api03-abcDEF1234567890abcdef';
  const line = `\n{"type":"user","sessionId":"6ca14529-41a8-4f4e-8bc9-d16dcbd4b6ca","message":{"content":"my key is ${secret}"}}\n`;
  const { proj, payload } = setup(line);
  fs.writeFileSync(path.join(proj, '.convo-sync.json'), '{"copyRaw":true}');
  const { mdPath } = await syncSession({ agent: 'claude', payload });
  assert.ok(!fs.readFileSync(mdPath, 'utf8').includes(secret));
  assert.ok(!fs.readFileSync(mdPath.replace(/\.md$/, '.jsonl'), 'utf8').includes(secret));
  assert.match(fs.readFileSync(mdPath, 'utf8'), /my key is \[REDACTED\]/);
});

test('missing transcript resolves to null without throwing', async () => {
  const { payload } = setup();
  const r = await syncSession({ agent: 'claude', payload: { ...payload, transcript_path: '/does/not/exist.jsonl' } });
  assert.deepEqual(r, { mdPath: null });
});

test('unknown agent resolves to null', async () => {
  assert.deepEqual(await syncSession({ agent: 'nope', payload: {} }), { mdPath: null });
});

test('CLI sync always exits 0 and prints {} even on garbage input', () => {
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'claude'], { input: 'garbage', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}\n');
});

test('CLI sync writes the note from a stdin payload', () => {
  const { proj, payload } = setup();
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'claude'], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}\n');
  assert.equal(fs.readdirSync(path.join(proj, '.agents', 'conversations')).filter((f) => f.endsWith('.md')).length, 1);
});

test('syncSession redacts the compaction summary', async () => {
  const secret = 'sk-ant-api03-abcDEF1234567890abcdef';
  const line = `\n{"type":"user","isCompactSummary":true,"message":{"content":"used key ${secret}"}}\n`;
  const { payload } = setup(line);
  const { mdPath } = await syncSession({ agent: 'claude', payload });
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.ok(!md.includes(secret));
  assert.match(md, /used key \[REDACTED\]/);
});

test('git file names in the summary are redacted', async () => {
  const secret = 'sk-ant-api03-abcDEF1234567890abcdef';
  const { proj, payload } = setup();
  fs.rmSync(path.join(proj, '.git'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: proj });
  fs.writeFileSync(path.join(proj, `${secret}.txt`), 'x');
  const { mdPath } = await syncSession({ agent: 'claude', payload });
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.match(md, /Uncommitted files/);
  assert.ok(!md.includes(secret));
});
