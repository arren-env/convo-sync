import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAntigravity, locateAntigravity } from '../scripts/lib/adapters/antigravity.mjs';

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
