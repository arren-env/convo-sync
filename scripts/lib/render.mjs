const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function safeId(id) {
  return String(id || 'unknown').replace(/^ses_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'unknown';
}

/**
 * e.g. 2026-11-05_1432_claude_6ca14529 (local start date and time, no colons so it is valid on Windows).
 * Without a start time the HHmm part is left out: using "now" would rename the note on every sync.
 */
export function fileBaseName(session) {
  const id = `${session.agent}_${safeId(session.sessionId)}`;
  const d = session.startedAt;
  if (!d) return `${localDate(new Date())}_${id}`;
  return `${localDate(d)}_${pad(d.getHours())}${pad(d.getMinutes())}_${id}`;
}

/** Name used before the start time was added: 2026-11-05_claude_6ca14529. */
export function legacyBaseName(session) {
  return `${localDate(session.startedAt || new Date())}_${session.agent}_${safeId(session.sessionId)}`;
}

function titleOf(session) {
  const first = session.messages.find((m) => m.role === 'user')?.text || `${session.agent} session`;
  const oneLine = first.replace(/\s+/g, ' ').trim().slice(0, 80);
  return JSON.stringify(oneLine);
}

const yamlStr = (s) => JSON.stringify(String(s ?? ''));

export const SUMMARY_HEADING = '## Summary';
// Ends the block unambiguously: summary text may itself contain the note's message separators.
export const SUMMARY_END = '<!-- /summary -->';
const CAP = { goal: 500, status: 1500, compact: 4000 };

function clip(text, max) {
  const t = String(text).trim();
  return t.length <= max ? t : `${t.slice(0, max - 14).trimEnd()} …[truncated]`;
}

/** Keep the end of the text instead of the start. */
function clipStart(text, max) {
  const t = String(text).trim();
  const mark = '…[earlier part cut] ';
  return t.length <= max ? t : `${mark}${t.slice(t.length - (max - mark.length)).trimStart()}`;
}

/**
 * Model-free summary placed before the messages: the goal, the latest answer,
 * code changes from git, and the agent's own compaction summary when it made one.
 */
function summaryLines(session) {
  const goal = session.messages.find((m) => m.role === 'user' && m.text.trim());
  const status = session.messages.findLast((m) => m.role === 'assistant' && m.text.trim());
  if (!goal && !status) return [];
  const lines = [SUMMARY_HEADING, ''];
  if (goal) lines.push(`**Goal:** ${clip(goal.text, CAP.goal)}`, '');
  // One assistant message can hold a whole turn of progress notes; the conclusion is at the end.
  if (status) lines.push(`**Status:** ${clipStart(status.text, CAP.status)}`, '');
  const { commits = [], files = [] } = session.git || {};
  if (commits.length) lines.push('**Commits since start:**', ...commits.map((c) => `- ${c}`), '');
  if (files.length) lines.push('**Uncommitted files:**', ...files.map((f) => `- \`${f}\``), '');
  if (session.compactSummary) {
    lines.push('**Earlier context (compacted by the agent):**', '', clip(session.compactSummary, CAP.compact), '');
  }
  lines.push(SUMMARY_END, '', '---', '');
  return lines;
}

/**
 * Render a session as an Obsidian-friendly Markdown note.
 * @param {import('./session.mjs').Session} session
 * @param {{includeThinking: boolean, includeTools: boolean}} opts
 */
export function toMarkdown(session, opts) {
  const now = new Date();
  const lines = [
    '---',
    `title: ${titleOf(session)}`,
    `agent: ${session.agent}`,
    ...(session.client ? [`client: ${session.client}`] : []),
    `session_id: ${session.sessionId}`,
    `project: ${yamlStr(session.cwd)}`,
    `created: ${localDateTime(session.startedAt || now)}`,
    `updated: ${localDateTime(session.updatedAt || now)}`,
    'tags:',
    '  - ai-chat',
    `  - ${session.agent}`,
    '---',
    '',
    ...summaryLines(session),
  ];

  for (const m of session.messages) {
    lines.push(m.role === 'user' ? '## User' : '## Assistant', '');
    if (m.role === 'assistant' && opts.includeThinking && m.thinking) {
      lines.push('> [!note]- Thinking');
      for (const t of m.thinking.split(/\r?\n/)) lines.push(`> ${t}`);
      lines.push('');
    }
    if (m.text) lines.push(m.text.trim(), '');
    if (m.role === 'assistant' && opts.includeTools && m.tools?.length) {
      lines.push(`*Tools: ${m.tools.join(', ')}*`, '');
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}
