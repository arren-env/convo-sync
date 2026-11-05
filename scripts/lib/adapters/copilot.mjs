// GitHub Copilot (CLI, and VS Code chat with the Copilot harness) transcripts:
// $COPILOT_HOME/session-state/<session-id>/events.jsonl  (COPILOT_HOME defaults to ~/.copilot)
// Not a documented format; unknown lines are skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonl, toDate, pushMessage, finalizeMessages } from '../session.mjs';

export const copilotHome = () => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');

/** @returns {import('../session.mjs').Session} */
export function parseCopilot(text, meta = {}) {
  const messages = [];
  let sessionId = null, cwd = null, startedAt = null, updatedAt = null;

  for (const line of readJsonl(text)) {
    const d = line.data;
    if (!d || typeof d !== 'object' || typeof line.type !== 'string') continue;
    const at = toDate(line.timestamp);
    if (at) { startedAt ??= at; updatedAt = at; }

    if (line.type === 'session.start') {
      sessionId ??= d.sessionId || null;
      cwd ??= d.context?.cwd || null;
      const t = toDate(d.startTime);
      if (t && (!startedAt || t < startedAt)) startedAt = t;
    } else if (line.type === 'user.message') {
      // `content` is what the user typed; `transformedContent` adds injected context.
      const body = typeof d.content === 'string' ? d.content.trim() : '';
      if (body) pushMessage(messages, { role: 'user', text: body, at });
    } else if (line.type === 'assistant.message') {
      if (d.parentToolCallId) continue; // a subagent's message, not the main conversation
      const tools = (Array.isArray(d.toolRequests) ? d.toolRequests : []).map((t) => t?.name).filter(Boolean);
      pushMessage(messages, {
        role: 'assistant',
        text: typeof d.content === 'string' ? d.content.trim() : '',
        thinking: typeof d.reasoningText === 'string' ? d.reasoningText.trim() : '',
        tools,
        at,
      });
    }
  }

  return {
    agent: 'copilot',
    sessionId: sessionId || meta.sessionId || 'unknown',
    cwd: cwd || meta.cwd || null,
    startedAt, updatedAt,
    messages: finalizeMessages(messages),
  };
}

/** agentStop payload (camelCase) or the VS Code-compatible Stop payload (snake_case). */
export function locateCopilot(payload = {}) {
  return {
    sessionId: payload.sessionId || payload.session_id || null,
    transcriptPath: payload.transcriptPath || payload.transcript_path || null,
    cwd: payload.cwd || null,
  };
}

/** session-state/<id>/events.jsonl, or null. Rejects ids that could escape the folder. */
export function findCopilotEvents(sessionId, home = copilotHome()) {
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const file = path.join(home, 'session-state', sessionId, 'events.jsonl');
  return fs.existsSync(file) ? file : null;
}

const CLIENTS = { 'github/cli': 'cli', 'vscode-agent-host': 'vscode' };

/** 'cli' | 'vscode' | other client_name from workspace.yaml next to events.jsonl, or null. */
export function copilotClient(transcriptPath) {
  try {
    const yaml = fs.readFileSync(path.join(path.dirname(transcriptPath), 'workspace.yaml'), 'utf8');
    const name = yaml.match(/^client_name:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m)?.[1];
    return name ? CLIENTS[name] || name.replace(/[^A-Za-z0-9/_.-]/g, '') : null;
  } catch {
    return null;
  }
}
