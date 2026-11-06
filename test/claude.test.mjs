import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseClaude, locateClaude } from '../scripts/lib/adapters/claude.mjs';

const text = fs.readFileSync(new URL('./fixtures/claude.jsonl', import.meta.url), 'utf8');

test('parses user/assistant turns, merges assistant blocks, drops noise', () => {
  const s = parseClaude(text, {});
  assert.equal(s.agent, 'claude');
  assert.deepEqual(s.messages.map(({ at, ...m }) => m), [
    { role: 'user', text: 'hi' },
    { role: 'assistant', text: 'hello\n\ndone', thinking: 'hmm', tools: ['Read'] },
    { role: 'user', text: 'second question' },
  ]);
});

test('session metadata comes from the transcript', () => {
  const s = parseClaude(text, {});
  assert.equal(s.sessionId, '6ca14529-41a8-4f4e-8bc9-d16dcbd4b6ca');
  assert.equal(s.cwd, '/home/u/demo');
  assert.equal(s.startedAt.toISOString(), '2026-11-05T04:55:29.000Z');
  assert.equal(s.updatedAt.toISOString(), '2026-11-05T05:01:00.000Z');
});

test('meta fills in when transcript lacks ids', () => {
  const s = parseClaude('{"type":"user","message":{"content":"x"}}', { sessionId: 'abc', cwd: '/p' });
  assert.equal(s.sessionId, 'abc');
  assert.equal(s.cwd, '/p');
});

test('empty or garbage input yields an empty session without throwing', () => {
  assert.deepEqual(parseClaude('nope', {}).messages, []);
});

test('locateClaude maps hook payload fields', () => {
  assert.deepEqual(locateClaude({ transcript_path: '/x.jsonl', session_id: 's', cwd: '/p' }),
    { transcriptPath: '/x.jsonl', sessionId: 's', cwd: '/p' });
  assert.deepEqual(locateClaude({}), { transcriptPath: null, sessionId: null, cwd: null });
});

test('parseClaude keeps the compaction summary out of the messages', () => {
  const line = (text, ts) => JSON.stringify({ type: 'user', isCompactSummary: true, timestamp: ts, message: { content: text } });
  const raw = [
    '{"type":"user","message":{"content":"start"}}',
    line('Summary of earlier work', '2026-11-05T05:00:00Z'),
    line('Newer summary', '2026-11-05T06:00:00Z'),
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
  ].join('\n');
  const s = parseClaude(raw, {});
  assert.equal(s.compactSummary, 'Newer summary');
  assert.ok(!s.messages.some((m) => /summary/i.test(m.text)), JSON.stringify(s.messages));
});

test('parseClaude strips the boilerplate around a compaction summary', () => {
  const text = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\n<tools-used-before-summary>Bash, Edit</tools-used-before-summary>\n</system-reminder>\n\nSummary:\n1. Primary request: dark mode icon';
  const raw = JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: text } });
  assert.equal(parseClaude(raw, {}).compactSummary, 'Summary:\n1. Primary request: dark mode icon');
});
