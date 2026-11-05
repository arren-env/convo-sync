import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCodex, locateCodex, findCodexRollout } from '../scripts/lib/adapters/codex.mjs';

const text = fs.readFileSync(new URL('./fixtures/codex.jsonl', import.meta.url), 'utf8');

test('parses user/assistant messages, drops harness context and developer role', () => {
  const s = parseCodex(text, {});
  assert.equal(s.agent, 'codex');
  assert.deepEqual(s.messages.map(({ at, ...m }) => m), [
    { role: 'user', text: 'fix the sync bug' },
    { role: 'assistant', text: 'Fixed it.', thinking: 'look at sync.js', tools: ['exec'] },
  ]);
});

test('session metadata comes from session_meta', () => {
  const s = parseCodex(text, {});
  assert.equal(s.sessionId, '01a176cc-9ca5-7072-9924-51f26b560e3b');
  assert.equal(s.cwd, '/home/u/notion');
  assert.equal(s.startedAt.toISOString(), '2026-10-26T06:01:23.535Z');
});

test('locateCodex maps hook payload fields, tolerating null transcript_path', () => {
  assert.deepEqual(locateCodex({ transcript_path: null, session_id: 's', cwd: '/p' }),
    { transcriptPath: null, sessionId: 's', cwd: '/p' });
});

test('findCodexRollout finds a rollout by session id, or returns null', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-codex-'));
  const day = path.join(home, 'sessions', '2026', '10', '26');
  fs.mkdirSync(day, { recursive: true });
  const f = path.join(day, 'rollout-2026-10-26T11-31-23-abc.jsonl');
  fs.writeFileSync(f, '');
  assert.equal(findCodexRollout('abc', home), f);
  assert.equal(findCodexRollout('missing', home), null);
  assert.equal(findCodexRollout('abc', path.join(home, 'nope')), null);
});

test('replayed history from auto-compaction or handoff is skipped', () => {
  const s = parseCodex(text, {});
  assert.ok(!s.messages.some((m) => m.text.includes('replayed')));
});
