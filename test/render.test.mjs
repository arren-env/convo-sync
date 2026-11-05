import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, fileBaseName } from '../scripts/lib/render.mjs';

const session = {
  agent: 'claude', sessionId: '6ca14529-41a8', cwd: '/p',
  startedAt: new Date(2026, 10, 5, 10), updatedAt: new Date(2026, 10, 5, 11),
  messages: [
    { role: 'user', text: 'hi' },
    { role: 'assistant', text: 'hello', thinking: 'secret thoughts', tools: ['Read', 'Edit'] },
  ],
};
const off = { includeThinking: false, includeTools: false };

test('fileBaseName uses local start date, agent and 8-char id', () => {
  assert.equal(fileBaseName(session), '2026-11-05_claude_6ca14529');
});

test('fileBaseName falls back to today when startedAt is null', () => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(fileBaseName({ ...session, startedAt: null }), `${today}_claude_6ca14529`);
});

test('markdown has frontmatter and turns', () => {
  const md = toMarkdown(session, off);
  assert.ok(md.startsWith('---\n'));
  assert.match(md, /agent: claude/);
  assert.match(md, /session_id: 6ca14529-41a8/);
  assert.match(md, /tags:\n  - ai-chat\n  - claude/);
  assert.match(md, /## User\n\nhi/);
  assert.match(md, /## Assistant\n\nhello/);
  assert.doesNotMatch(md, /secret thoughts/);
  assert.doesNotMatch(md, /\*Tools:/);
});

test('thinking appears in a collapsed callout when enabled', () => {
  const md = toMarkdown(session, { ...off, includeThinking: true });
  assert.match(md, /> \[!note\]- Thinking\n> secret thoughts/);
});

test('tools line appears when enabled', () => {
  const md = toMarkdown(session, { ...off, includeTools: true });
  assert.match(md, /\*Tools: Read, Edit\*/);
});

test('title is first user message, collapsed, escaped, max 80 chars', () => {
  const long = 'say "hi"\nthen ' + 'x'.repeat(200);
  const md = toMarkdown({ ...session, messages: [{ role: 'user', text: long }] }, off);
  const title = md.match(/^title: (.*)$/m)[1];
  assert.ok(title.startsWith('"say \\"hi\\" then x'));
  assert.ok(title.endsWith('"'));
  assert.ok(!title.includes('\n'));
  assert.ok(JSON.parse(title).length <= 80);
});

test('fileBaseName drops an agent prefix like ses_ before taking 8 chars', () => {
  assert.equal(fileBaseName({ ...session, agent: 'opencode', sessionId: 'ses_15a464b39ffeDC4' }), '2026-11-05_opencode_15a464b3');
});
