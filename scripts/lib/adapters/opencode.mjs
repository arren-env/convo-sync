// OpenCode: the convo-sync plugin fetches messages via OpenCode's own client
// (client.session.messages) and passes them here, so we never read its SQLite DB.
// Shape (verified against @opencode-ai/sdk, plugin 1.15.11):
//   Array<{ info: { role, time: { created } }, parts: Array<{ type: 'text'|'reasoning'|'tool'|..., text?, tool?, synthetic? }> }>
import { toDate, pushMessage, finalizeMessages } from '../session.mjs';

/** @returns {import('../session.mjs').Session} */
export function parseOpenCode(payload = {}) {
  let list = payload?.messages;
  if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
  if (!Array.isArray(list)) list = [];

  const messages = [];
  let startedAt = null, updatedAt = null;

  for (const item of list) {
    const role = item?.info?.role;
    const parts = Array.isArray(item?.parts) ? item.parts : [];
    const at = toDate(item?.info?.time?.created);
    if (at) { startedAt ??= at; updatedAt = at; }
    if (role !== 'user' && role !== 'assistant') continue;

    const text = [], thinking = [], tools = [];
    for (const p of parts) {
      if (p?.type === 'text' && typeof p.text === 'string' && !p.synthetic && p.text.trim()) text.push(p.text.trim());
      else if (p?.type === 'reasoning' && typeof p.text === 'string' && p.text.trim()) thinking.push(p.text.trim());
      else if (p?.type === 'tool' && p.tool) tools.push(p.tool);
    }
    if (role === 'user') {
      if (text.length) pushMessage(messages, { role, text: text.join('\n\n'), at });
    } else {
      pushMessage(messages, { role, text: text.join('\n\n'), thinking: thinking.join('\n\n'), tools, at });
    }
  }

  return {
    agent: 'opencode',
    sessionId: payload?.sessionId || 'unknown',
    cwd: payload?.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}
