// OpenCode: the convo-sync plugin fetches messages via OpenCode's own client
// and passes them here, so we never read its SQLite DB. Two shapes:
//   1.x (@opencode-ai/sdk, plugin 1.15.11, client.session.messages):
//     Array<{ info: { role, time: { created } }, parts: Array<{ type: 'text'|'reasoning'|'tool'|..., text?, tool?, synthetic? }> }>
//   2.x (@opencode/client 2.2.5, session.context):
//     Array<{ type: 'user', text, time } | { type: 'assistant', time, content: Array<{ type: 'text'|'reasoning', text } | { type: 'tool', name }> }
//           | { type: 'synthetic'|'system'|'idle'|..., ... }>   (only user/assistant are kept)
import { toDate, pushMessage, finalizeMessages } from '../session.mjs';

/** @returns {import('../session.mjs').Session} */
export function parseOpenCode(payload = {}) {
  let list = payload?.messages;
  if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
  if (!Array.isArray(list)) list = [];

  const messages = [];
  let startedAt = null, updatedAt = null;

  for (const item of list) {
    if (item && !item.info && typeof item.type === 'string') {
      const at = toDate(item.time?.created);
      if (at) { startedAt ??= at; updatedAt = at; }
      pushV2(messages, item, at);
      continue;
    }
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

// OpenCode 2.x message (see shape at top).
function pushV2(messages, item, at) {
  if (item.type === 'user') {
    if (typeof item.text === 'string' && item.text.trim()) pushMessage(messages, { role: 'user', text: item.text.trim(), at });
    return;
  }
  if (item.type !== 'assistant') return;
  const text = [], thinking = [], tools = [];
  for (const p of Array.isArray(item.content) ? item.content : []) {
    if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) text.push(p.text.trim());
    else if (p?.type === 'reasoning' && typeof p.text === 'string' && p.text.trim()) thinking.push(p.text.trim());
    else if (p?.type === 'tool' && p.name) tools.push(p.name);
  }
  pushMessage(messages, { role: 'assistant', text: text.join('\n\n'), thinking: thinking.join('\n\n'), tools, at });
}
