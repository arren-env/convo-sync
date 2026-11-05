/**
 * Shared session model used by every adapter.
 *
 * @typedef {'claude'|'codex'|'antigravity'|'opencode'|'copilot'} Agent
 * @typedef {{ role: 'user'|'assistant', text: string, thinking?: string, tools?: string[], at?: Date }} Message
 * @typedef {{ agent: Agent, sessionId: string, cwd: string|null, startedAt: Date|null, updatedAt: Date|null, messages: Message[] }} Session
 */

/** Parse JSONL text, tolerating a BOM, CRLF line endings, blank and malformed lines. */
export function readJsonl(text) {
  const out = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') out.push(value);
    } catch {
      // Skip lines we can't parse; formats are unofficial and may change.
    }
  }
  return out;
}

/** Parse a timestamp (ISO string, epoch ms, or epoch seconds) into a Date, or null. */
export function toDate(value) {
  if (value == null || value === '') return null;
  let v = value;
  if (typeof v === 'number' && v < 1e12) v *= 1000; // epoch seconds
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Append a message, merging consecutive assistant messages into one
 * (agents often write one line per content block or per tool call).
 */
export function pushMessage(messages, msg) {
  const last = messages[messages.length - 1];
  if (msg.role === 'assistant' && last && last.role === 'assistant') {
    if (msg.text) last.text = last.text ? `${last.text}\n\n${msg.text}` : msg.text;
    if (msg.thinking) last.thinking = last.thinking ? `${last.thinking}\n\n${msg.thinking}` : msg.thinking;
    if (msg.tools?.length) last.tools = [...(last.tools || []), ...msg.tools];
    return;
  }
  const clean = { role: msg.role, text: msg.text || '' };
  if (msg.thinking) clean.thinking = msg.thinking;
  if (msg.tools?.length) clean.tools = [...msg.tools];
  if (msg.at) clean.at = msg.at;
  messages.push(clean);
}

/** Drop assistant messages that ended up with no visible content. */
export function finalizeMessages(messages) {
  return messages.filter((m) => m.role === 'user' ? m.text.trim() : (m.text.trim() || m.thinking || m.tools?.length));
}
