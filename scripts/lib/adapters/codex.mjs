// Codex CLI transcripts: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl
// Not a stable interface; unknown lines are skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonl, toDate, pushMessage, finalizeMessages } from '../session.mjs';

const NOISE_PREFIXES = ['<environment_context>', '<user_instructions>', '<permissions', '# AGENTS.md'];
const TOOL_CALL_TYPES = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call']);

/** @returns {import('../session.mjs').Session} */
export function parseCodex(text, meta = {}) {
  const messages = [];
  let sessionId = null, cwd = null, startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    const at = toDate(line.timestamp);
    if (at) { startedAt ??= at; updatedAt = at; }
    const p = line.payload;
    if (!p || typeof p !== 'object') continue;

    if (line.type === 'session_meta') {
      sessionId ??= p.id || p.session_id || null;
      cwd ??= p.cwd || null;
      const metaAt = toDate(p.timestamp);
      if (metaAt && (!startedAt || metaAt < startedAt)) startedAt = metaAt;
      continue;
    }
    if (line.type !== 'response_item') continue;

    // History replayed after auto-compaction or a thread handoff; the real turns are earlier in the file.
    const turnId = p.internal_chat_message_metadata_passthrough?.turn_id;
    if (typeof turnId === 'string' && turnId.startsWith('auto-compact')) continue;

    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const body = (Array.isArray(p.content) ? p.content : [])
        .filter((c) => (c?.type === 'input_text' || c?.type === 'output_text') && typeof c.text === 'string')
        .map((c) => c.text.trim())
        .filter((t) => t && !(p.role === 'user' && NOISE_PREFIXES.some((n) => t.startsWith(n))))
        .join('\n\n');
      if (body) pushMessage(messages, { role: p.role, text: body, at });
    } else if (TOOL_CALL_TYPES.has(p.type)) {
      pushMessage(messages, { role: 'assistant', text: '', tools: [p.name || p.type], at });
    } else if (p.type === 'reasoning') {
      const thinking = (Array.isArray(p.summary) ? p.summary : [])
        .map((s) => (typeof s?.text === 'string' ? s.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n');
      if (thinking) pushMessage(messages, { role: 'assistant', text: '', thinking, at });
    }
  }

  return {
    agent: 'codex',
    sessionId: sessionId || meta.sessionId || 'unknown',
    cwd: cwd || meta.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}

/** Codex Stop hook payload (snake_case, on stdin). transcript_path may be null. */
export function locateCodex(payload = {}) {
  return {
    transcriptPath: payload.transcript_path || null,
    sessionId: payload.session_id || payload['thread-id'] || null,
    cwd: payload.cwd || null,
  };
}

const listDirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
  } catch {
    return [];
  }
};

/** Find the rollout file for a session id, newest day folders first. */
export function findCodexRollout(sessionId, home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  if (!sessionId) return null;
  const root = path.join(home, 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  for (const y of listDirs(root)) {
    for (const m of listDirs(path.join(root, y))) {
      for (const d of listDirs(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        let files = [];
        try { files = fs.readdirSync(dir); } catch { continue; }
        const hit = files.find((f) => f.endsWith(suffix));
        if (hit) return path.join(dir, hit);
      }
    }
  }
  return null;
}
