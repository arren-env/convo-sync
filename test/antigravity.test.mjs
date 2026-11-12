import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseAntigravity, locateAntigravity, findAntigravityTranscript, cwdFromAntigravityMeta,
} from '../scripts/lib/adapters/antigravity.mjs';

const text = fs.readFileSync(new URL('./fixtures/antigravity.jsonl', import.meta.url), 'utf8');

test('parses USER_INPUT and PLANNER_RESPONSE, skips GENERIC', () => {
  const s = parseAntigravity(text, { sessionId: '146744c2-d904', cwd: '/p' });
  assert.equal(s.agent, 'antigravity');
  assert.deepEqual(s.messages.map(({ at, ...m }) => m), [
    { role: 'user', text: 'hi' },
    { role: 'assistant', text: 'hello', tools: ['view_file'] },
    { role: 'user', text: 'plain text without tags' },
    { role: 'assistant', text: 'answer two', thinking: 'pondering' },
  ]);
  assert.equal(s.sessionId, '146744c2-d904');
  assert.equal(s.startedAt.toISOString(), '2026-11-05T04:30:00.000Z');
});

test('parseAntigravity prefers inner <user_request> from T3-wrapped USER_REQUEST', () => {
  const line = JSON.stringify({
    source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-12T10:00:00Z',
    content: '<USER_REQUEST>\n<t3_code_instructions>\nnoise\n</t3_code_instructions>\n\n<user_request>\nhey there\n</user_request>\n</USER_REQUEST>',
  });
  const s = parseAntigravity(`${line}\n`);
  assert.deepEqual(s.messages.map((m) => m.text), ['hey there']);
});

test('locateAntigravity reads camelCase payload', () => {
  assert.deepEqual(
    locateAntigravity({ conversationId: 'c1', transcriptPath: '/t.jsonl', workspacePaths: ['/w', '/x'] }),
    { transcriptPath: '/t.jsonl', sessionId: 'c1', cwd: '/w' });
});

test('locateAntigravity derives the id from the brain path when missing', () => {
  const p = '/home/u/.gemini/antigravity/brain/146744c2-d904-473e-8478-815ebd4f86ca/.system_generated/logs/transcript.jsonl';
  assert.equal(locateAntigravity({ transcriptPath: p }).sessionId, '146744c2-d904-473e-8478-815ebd4f86ca');
  assert.deepEqual(locateAntigravity({}), { transcriptPath: null, sessionId: null, cwd: null });
});

test('findAntigravityTranscript and cwdFromAntigravityMeta read T3-style layout', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ag-'));
  const id = '146744c2-d904-473e-8478-815ebd4f86ca';
  const app = path.join(home, '.t3', 'userdata', 'providers', 'antigravity', 'deadbeef', 'antigravity-acp');
  const transcript = path.join(app, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '{}\n');
  fs.mkdirSync(path.join(app, 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(app, 'conversations', `${id}.meta`), JSON.stringify({ cwd: 'C:\\proj' }));
  assert.equal(findAntigravityTranscript(id, home), transcript);
  assert.equal(cwdFromAntigravityMeta(transcript, id), 'C:\\proj');
  assert.equal(locateAntigravity({ transcriptPath: transcript }).cwd, 'C:\\proj');
});

test('locateAntigravity maps the ACP server conversations/<id>.db path to the brain transcript', () => {
  // T3 Code runs agy_acp_server, whose PostInvocation payload points transcriptPath at a SQLite file.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ag-'));
  const id = '146744c2-d904-473e-8478-815ebd4f86ca';
  const app = path.join(home, 'antigravity-acp');
  const transcript = path.join(app, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '{}\n');
  fs.mkdirSync(path.join(app, 'conversations'), { recursive: true });
  const db = path.join(app, 'conversations', `${id}.db`);
  fs.writeFileSync(db, 'SQLite format 3\0');
  fs.writeFileSync(path.join(app, 'conversations', `${id}.meta`), JSON.stringify({ cwd: 'C:\\proj' }));
  assert.deepEqual(
    locateAntigravity({ conversationId: id, transcriptPath: db, workspacePaths: ['C:\\w'] }),
    { transcriptPath: transcript, sessionId: id, cwd: 'C:\\w' });
  assert.equal(locateAntigravity({ conversationId: id, transcriptPath: db }).cwd, 'C:\\proj');
});
