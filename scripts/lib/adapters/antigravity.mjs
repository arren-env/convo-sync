// Antigravity transcripts: ~/.gemini/antigravity*/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
// Format is undocumented; derived from observed files. Unknown lines are skipped.
import { readJsonl, toDate, pushMessage, finalizeMessages } from '../session.mjs';

const USER_REQUEST = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
const BRAIN_ID = /brain[\\/]([0-9a-fA-F-]{36})/;

/** @returns {import('../session.mjs').Session} */
export function parseAntigravity(text, meta = {}) {
  const messages = [];
  let startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    const at = toDate(line.created_at);
    if (at) { startedAt ??= at; updatedAt = at; }

    if (line.source === 'USER_EXPLICIT' && typeof line.content === 'string') {
      const m = line.content.match(USER_REQUEST);
      const body = (m ? m[1] : line.content).trim();
      if (body) pushMessage(messages, { role: 'user', text: body, at });
    } else if (line.source === 'MODEL' && line.type === 'PLANNER_RESPONSE') {
      const body = typeof line.content === 'string' ? line.content.trim() : '';
      const thinking = typeof line.thinking === 'string' ? line.thinking.trim() : '';
      const tools = Array.isArray(line.tool_calls) ? line.tool_calls.map((t) => t?.name).filter(Boolean) : [];
      if (body || thinking || tools.length) pushMessage(messages, { role: 'assistant', text: body, thinking, tools, at });
    }
  }

  return {
    agent: 'antigravity',
    sessionId: meta.sessionId || 'unknown',
    cwd: meta.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}

/** Antigravity hook payload (camelCase, on stdin). */
export function locateAntigravity(payload = {}) {
  const transcriptPath = payload.transcriptPath || null;
  const fromPath = transcriptPath?.match(BRAIN_ID)?.[1] || null;
  return {
    transcriptPath,
    sessionId: payload.conversationId || fromPath,
    cwd: Array.isArray(payload.workspacePaths) && payload.workspacePaths[0] ? payload.workspacePaths[0] : null,
  };
}
