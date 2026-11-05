const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function safeId(id) {
  return String(id || 'unknown').replace(/^ses_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'unknown';
}

/** e.g. 2026-11-05_claude_6ca14529 */
export function fileBaseName(session) {
  return `${localDate(session.startedAt || new Date())}_${session.agent}_${safeId(session.sessionId)}`;
}

function titleOf(session) {
  const first = session.messages.find((m) => m.role === 'user')?.text || `${session.agent} session`;
  const oneLine = first.replace(/\s+/g, ' ').trim().slice(0, 80);
  return JSON.stringify(oneLine);
}

const yamlStr = (s) => JSON.stringify(String(s ?? ''));

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
