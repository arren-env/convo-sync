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

test('toMarkdown writes a summary block before the first message', () => {
  const md = toMarkdown({
    ...session,
    compactSummary: 'We picked GitHub Actions.',
    git: { commits: ['abc1234 add workflow'], files: [' M README.md'] },
  }, off);
  const iSummary = md.indexOf('## Summary');
  assert.ok(iSummary > 0 && iSummary < md.indexOf('## User'), md);
  assert.match(md, /\*\*Goal:\*\* hi/);
  assert.match(md, /\*\*Status:\*\* hello/);
  assert.match(md, /\*\*Commits since start:\*\*\n- abc1234 add workflow/);
  assert.match(md, /\*\*Uncommitted files:\*\*\n- ` M README\.md`/);
  assert.match(md, /\*\*Earlier context \(compacted by the agent\):\*\*\n\nWe picked GitHub Actions\./);
});

test('toMarkdown omits empty summary sections', () => {
  const md = toMarkdown(session, off);
  assert.match(md, /## Summary/);
  assert.doesNotMatch(md, /Commits since start|Uncommitted files|Earlier context/);
});

test('toMarkdown caps long summary fields', () => {
  const md = toMarkdown({ ...session, compactSummary: 'c'.repeat(9000), messages: [
    { role: 'user', text: 'g'.repeat(2000) }, { role: 'assistant', text: 's'.repeat(5000) },
  ] }, off);
  const block = md.slice(md.indexOf('## Summary'), md.indexOf('## User'));
  assert.ok(block.length < 500 + 1500 + 4000 + 400, `block ${block.length}`);
  assert.match(block, /…\[truncated\]/);
});

test('a long status keeps the end of the latest answer, where the conclusion is', () => {
  const text = `${'progress note. '.repeat(300)}FINAL ANSWER`;
  const md = toMarkdown({ ...session, messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text }] }, off);
  const status = md.slice(md.indexOf('**Status:**'), md.indexOf('<!-- /summary -->'));
  assert.match(status, /FINAL ANSWER/);
  assert.match(status, /^\*\*Status:\*\* …\[earlier part cut\] /);
  assert.ok(status.length < 1600, `status ${status.length}`);
});
