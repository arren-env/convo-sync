// Antigravity transcripts: ~/.gemini/antigravity*/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
// T3 Code uses a private GEMINI_HOME under ~/.t3/userdata/providers/antigravity/<hash>/antigravity-acp/...
// Format is undocumented; derived from observed files. Unknown lines are skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonl, toDate, pushMessage, finalizeMessages } from '../session.mjs';

const USER_REQUEST = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
const INNER_USER_REQUEST = /<user_request>([\s\S]*?)<\/user_request>/i;
const BRAIN_ID = /brain[\\/]([0-9a-fA-F-]{36})/;
const SESSION_ID = /^[0-9a-fA-F-]{36}$/;

/** Prefer the inner <user_request> T3 wraps inside USER_REQUEST; otherwise the whole block. */
function userBody(content) {
  const outer = content.match(USER_REQUEST);
  const body = (outer ? outer[1] : content).trim();
  const inner = body.match(INNER_USER_REQUEST);
  return (inner ? inner[1] : body).trim();
}

/** App-data roots that can hold brain/<id>/.../transcript.jsonl. */
export function antigravityDataRoots(home = os.homedir()) {
  const roots = ['antigravity', 'antigravity-cli', 'antigravity-ide', 'antigravity-backup']
    .map((name) => path.join(home, '.gemini', name));
  const t3 = path.join(home, '.t3', 'userdata', 'providers', 'antigravity');
  try {
    for (const name of fs.readdirSync(t3)) {
      const profile = path.join(t3, name);
      for (const sub of ['antigravity-acp', 'antigravity-cli', 'antigravity']) {
        roots.push(path.join(profile, sub));
      }
    }
  } catch { /* no T3 profiles */ }
  return roots;
}

/** Find transcript.jsonl for a conversation id across Gemini and T3 Code profiles. */
export function findAntigravityTranscript(sessionId, home = os.homedir()) {
  if (!sessionId || !SESSION_ID.test(sessionId)) return null;
  for (const root of antigravityDataRoots(home)) {
    const file = path.join(root, 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** cwd from <app_data>/conversations/<id>.meta beside the brain folder (T3 / CLI). */
export function cwdFromAntigravityMeta(transcriptPath, sessionId) {
  const id = sessionId || transcriptPath?.match(BRAIN_ID)?.[1];
  if (!transcriptPath || !id) return null;
  let dir = path.resolve(transcriptPath);
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(dir);
    if (path.basename(dir) === 'brain') {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(parent, 'conversations', `${id}.meta`), 'utf8'));
        return typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : null;
      } catch { return null; }
    }
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** @returns {import('../session.mjs').Session} */
export function parseAntigravity(text, meta = {}) {
  const messages = [];
  let startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    const at = toDate(line.created_at);
    if (at) { startedAt ??= at; updatedAt = at; }

    if (line.source === 'USER_EXPLICIT' && typeof line.content === 'string') {
      const body = userBody(line.content);
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

/**
 * The ACP server (agy_acp_server, used by T3 Code) sends transcriptPath as
 * <app_data>/conversations/<id>.db, a SQLite trajectory. The readable JSONL lives at
 * <app_data>/brain/<id>/.system_generated/logs/transcript.jsonl.
 */
function brainTranscriptFor(transcriptPath, sessionId) {
  if (!transcriptPath || path.extname(transcriptPath).toLowerCase() !== '.db') return transcriptPath;
  const id = sessionId || path.basename(transcriptPath, path.extname(transcriptPath));
  const appData = path.dirname(path.dirname(transcriptPath));
  return path.join(appData, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
}

/** Antigravity hook payload (camelCase, on stdin). */
export function locateAntigravity(payload = {}) {
  const fromPath = payload.transcriptPath?.match(BRAIN_ID)?.[1] || null;
  const sessionId = payload.conversationId || fromPath;
  const transcriptPath = brainTranscriptFor(payload.transcriptPath || null, sessionId);
  const fromWorkspace = Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]
    ? payload.workspacePaths[0]
    : null;
  return {
    transcriptPath,
    sessionId,
    cwd: fromWorkspace || cwdFromAntigravityMeta(transcriptPath, sessionId),
  };
}
