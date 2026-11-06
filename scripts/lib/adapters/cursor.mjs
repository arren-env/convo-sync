// Cursor agent transcripts (editor and the `agent` / cursor-agent CLI write the same format):
// ~/.cursor/projects/<project-slug>/agent-transcripts/<conversation-id>/<conversation-id>.jsonl
// Not a documented format; unknown lines are skipped. Lines carry no timestamps, ids or cwd:
// times come from the <timestamp> tag Cursor puts in each user turn, the rest from the hook payload.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonl, pushMessage, finalizeMessages } from '../session.mjs';

export const cursorHome = () => path.join(os.homedir(), '.cursor');

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "Friday, Nov 6, 2026, 11:18 AM (UTC+5:30)" -> Date, or null. */
export function parseCursorTimestamp(text) {
  const m = String(text).match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC(?:([+-])(\d{1,2})(?::(\d{2}))?)?\)/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month == null) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  const offsetMin = m[7] ? (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9] || 0)) : 0;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5])) - offsetMin * 60000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The user's own words: the <user_query> blocks, or the text minus Cursor's context tags. */
function userText(raw) {
  const queries = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)].map((m) => m[1].trim()).filter(Boolean);
  if (queries.length) return queries.join('\n\n');
  return raw.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '').trim();
}

/** @returns {import('../session.mjs').Session} */
export function parseCursor(text, meta = {}) {
  const messages = [];
  let startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    if (line.role !== 'user' && line.role !== 'assistant') continue; // e.g. {"type":"turn_ended"}
    const content = Array.isArray(line.message?.content) ? line.message.content : [];
    if (line.role === 'user') {
      const raw = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
      const stamp = raw.match(/<timestamp>([\s\S]*?)<\/timestamp>/);
      const at = stamp ? parseCursorTimestamp(stamp[1]) : null;
      if (at) { startedAt ??= at; updatedAt = at; }
      const body = userText(raw);
      if (body) pushMessage(messages, { role: 'user', text: body, at: at || undefined });
    } else {
      pushMessage(messages, {
        role: 'assistant',
        text: content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text.trim()).filter(Boolean).join('\n\n'),
        thinking: content.filter((c) => c?.type === 'thinking' && typeof c.thinking === 'string').map((c) => c.thinking.trim()).join('\n\n'),
        tools: content.filter((c) => c?.type === 'tool_use' && c.name).map((c) => c.name),
      });
    }
  }

  return {
    agent: 'cursor',
    sessionId: meta.sessionId || 'unknown',
    cwd: meta.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}

/** Cursor may send Windows roots as /c:/path; turn that into c:/path. */
function rootPath(p) {
  if (typeof p !== 'string' || !p) return null;
  return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p;
}

/** Cursor `stop` hook payload: conversation_id, transcript_path (may be null), workspace_roots. */
export function locateCursor(payload = {}) {
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  return {
    sessionId: payload.conversation_id || null,
    transcriptPath: payload.transcript_path || null,
    cwd: rootPath(payload.cwd) || rootPath(roots[0]),
  };
}

/** projects/<any>/agent-transcripts/<id>/<id>.jsonl, or null. Rejects ids that could escape the folder. */
export function findCursorTranscript(sessionId, home = cursorHome()) {
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const projects = path.join(home, 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  for (const dir of dirs) {
    const file = path.join(projects, dir, 'agent-transcripts', sessionId, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** <home>/projects/<slug>/agent-transcripts/<id>/<id>.jsonl -> <home>; otherwise ~/.cursor. */
function homeOf(transcriptPath) {
  const parts = path.resolve(transcriptPath).split(path.sep);
  const i = parts.lastIndexOf('agent-transcripts');
  return i >= 3 && parts[i - 2] === 'projects' ? parts.slice(0, i - 2).join(path.sep) : cursorHome();
}

/** 'cli' when the CLI keeps a chat folder for this conversation (~/.cursor/chats/<hash>/<id>), else 'editor'. */
export function cursorClient(transcriptPath, home = homeOf(transcriptPath)) {
  const id = path.basename(transcriptPath, '.jsonl');
  try {
    for (const hash of fs.readdirSync(path.join(home, 'chats'))) {
      if (fs.existsSync(path.join(home, 'chats', hash, id))) return 'cli';
    }
  } catch { /* no chats folder */ }
  return 'editor';
}

/** Fill times the transcript can't give: no timestamps at all, or activity after the last user turn. */
export function cursorFileTimes(session, transcriptPath) {
  try {
    const st = fs.statSync(transcriptPath);
    if (!session.startedAt) session.startedAt = st.birthtime?.getTime() ? st.birthtime : st.mtime;
    if (!session.updatedAt || st.mtime > session.updatedAt) session.updatedAt = st.mtime;
  } catch { /* keep what the transcript gave */ }
}
