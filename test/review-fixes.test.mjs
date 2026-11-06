import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, redactJsonl } from '../scripts/lib/redact.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { install, targetFile } from '../scripts/lib/install.mjs';
import { syncSession } from '../scripts/lib/sync.mjs';
import { fileBaseName } from '../scripts/lib/render.mjs';

// C1: raw JSONL redaction must work on escaped quotes and keep every line valid JSON.
test('redactJsonl redacts quoted secrets inside JSON strings and keeps lines valid', () => {
  const lines = [
    JSON.stringify({ message: { content: 'set DB_PASSWORD="hunter22secret"' } }),
    JSON.stringify({ text: 'echo token=abc123"' }),
    'not json sk-ant-api03-abcDEF1234567890abcdef',
  ].join('\n');
  const out = redactJsonl(lines);
  assert.ok(!out.includes('hunter22secret'));
  assert.ok(!out.includes('sk-ant-api03-abcDEF1234567890abcdef'));
  const [a, b] = out.split('\n');
  assert.doesNotThrow(() => JSON.parse(a));
  assert.doesNotThrow(() => JSON.parse(b));
});

// I5: ordinary code must survive redaction.
test('redaction leaves common code untouched', () => {
  for (const s of ['const token = getToken()', 'maxTokens: 4096', 'input_tokens=1523', 'password: string']) {
    assert.equal(redact(s), s);
  }
  assert.equal(redact('access_token=abcd1234efgh'), 'access_token=[REDACTED]');
  assert.equal(redact('PASSWORD=hunter2'), 'PASSWORD=[REDACTED]');
});

// I4: raw transcript copy is opt-in.
test('copyRaw defaults to false', () => {
  assert.equal(DEFAULTS.copyRaw, false);
});

// I1: Claude project scope uses the git-ignored local settings file.
test('claude project scope targets .claude/settings.local.json', () => {
  assert.equal(targetFile('claude', 'project', '/p', '/h'), path.join('/p', '.claude', 'settings.local.json'));
});

// I3: a failed rename must not leave temp files in the conversations folder.
test('failed write leaves no .tmp files behind', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rev-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const transcript = path.join(tmp, 't.jsonl');
  fs.writeFileSync(transcript, '{"type":"user","timestamp":"2026-11-05T05:00:00.000Z","message":{"content":"hi"}}\n');
  const base = fileBaseName({ agent: 'claude', sessionId: 'abcdefgh-1', startedAt: new Date('2026-11-05T05:00:00.000Z') });
  const outDir = path.join(proj, '.agents', 'conversations');
  // Block the rename by putting a non-empty directory where the note should go.
  fs.mkdirSync(path.join(outDir, `${base}.md`, 'x'), { recursive: true });
  await assert.rejects(syncSession({ agent: 'claude', payload: { transcript_path: transcript, session_id: 'abcdefgh-1', cwd: proj } }));
  assert.deepEqual(fs.readdirSync(outDir).filter((f) => f.endsWith('.tmp')), []);
});

// I2: if the plugin can't launch node, its temp payload must not be left behind.
test('opencode plugin removes its payload file when node cannot be spawned', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-rev-'));
  const r = install({ agent: 'opencode', scope: 'project', projectRoot: tmp, home: tmp, scriptPath: path.join(tmp, 'convo-sync.mjs') });
  const mod = await import('file://' + r.file.split(path.sep).join('/'));
  const id = `ses_test${Date.now()}`;
  const client = { session: { messages: async () => ({ data: [] }) } };
  const hooks = await mod.ConvoSync({ client, directory: tmp });
  const savedPath = process.env.PATH;
  const savedPath2 = process.env.Path;
  process.env.PATH = ''; if (savedPath2 !== undefined) process.env.Path = '';
  try {
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: id } } });
    await new Promise((res) => setTimeout(res, 500));
  } finally {
    process.env.PATH = savedPath; if (savedPath2 !== undefined) process.env.Path = savedPath2;
  }
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((f) => f.includes(id)), []);
});
