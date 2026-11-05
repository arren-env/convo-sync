// Claude Code transcripts: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// The line format is not officially documented; unknown lines are skipped.
import { readJsonl, toDate, pushMessage, finalizeMessages } from '../session.mjs';

const NOISE_PREFIXES = ['<command-', '<local-command-', '<system-reminder>', '<task-notification>'];

function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

/** @returns {import('../session.mjs').Session} */
export function parseClaude(text, meta = {}) {
  const messages = [];
  let sessionId = null, cwd = null, startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    const at = toDate(line.timestamp);
    if (at) { startedAt ??= at; updatedAt = at; }
    sessionId ??= line.sessionId || null;
    if (line.type !== 'user' && line.type !== 'assistant') continue;
    if (line.isSidechain || line.isMeta) continue;
    cwd ??= line.cwd || null;

    const blocks = blocksOf(line.message?.content);
    if (line.type === 'user') {
      const userText = blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text.trim())
        .filter((t) => t && !NOISE_PREFIXES.some((p) => t.startsWith(p)))
        .join('\n\n');
      if (userText) pushMessage(messages, { role: 'user', text: userText, at });
    } else {
      const textParts = [], thinking = [], tools = [];
      for (const b of blocks) {
        if (b?.type === 'text' && b.text?.trim()) textParts.push(b.text.trim());
        else if (b?.type === 'thinking' && b.thinking?.trim()) thinking.push(b.thinking.trim());
        else if (b?.type === 'tool_use' && b.name) tools.push(b.name);
      }
      pushMessage(messages, { role: 'assistant', text: textParts.join('\n\n'), thinking: thinking.join('\n\n'), tools, at });
    }
  }

  return {
    agent: 'claude',
    sessionId: sessionId || meta.sessionId || 'unknown',
    cwd: cwd || meta.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}

/** Claude Code Stop / SessionEnd hook payload (snake_case, on stdin). */
export function locateClaude(payload = {}) {
  return {
    transcriptPath: payload.transcript_path || null,
    sessionId: payload.session_id || null,
    cwd: payload.cwd || null,
  };
}
