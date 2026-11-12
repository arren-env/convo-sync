import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { redact, redactJsonl } from './redact.mjs';
import { toMarkdown, fileBaseName, legacyBaseName } from './render.mjs';
import { gitFacts } from './git.mjs';
import { parseClaude, locateClaude } from './adapters/claude.mjs';
import { parseCodex, locateCodex, findCodexRollout } from './adapters/codex.mjs';
import { parseAntigravity, locateAntigravity, findAntigravityTranscript } from './adapters/antigravity.mjs';
import { parseOpenCode } from './adapters/opencode.mjs';
import { parseCopilot, locateCopilot, findCopilotEvents, copilotClient } from './adapters/copilot.mjs';
import { parseCursor, locateCursor, findCursorTranscript, cursorClient, cursorFileTimes } from './adapters/cursor.mjs';

export const AGENTS = ['claude', 'codex', 'antigravity', 'opencode', 'copilot', 'cursor'];

const FILE_ADAPTERS = {
  claude: { parse: parseClaude, locate: locateClaude },
  codex: { parse: parseCodex, locate: locateCodex, fallback: (loc) => findCodexRollout(loc.sessionId) },
  antigravity: { parse: parseAntigravity, locate: locateAntigravity, fallback: (loc) => findAntigravityTranscript(loc.sessionId) },
  copilot: { parse: parseCopilot, locate: locateCopilot, fallback: (loc) => findCopilotEvents(loc.sessionId), client: copilotClient },
  cursor: { parse: parseCursor, locate: locateCursor, fallback: (loc) => findCursorTranscript(loc.sessionId), client: cursorClient, times: cursorFileTimes, requireCwd: true },
};

/** Walk up from cwd to the first directory containing .git; otherwise cwd itself. */
export function projectRootFor(cwd) {
  const start = path.resolve(cwd);
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    // After a successful rename this is a no-op; after a failure it removes the leftover.
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

/**
 * Rename a note (and its .jsonl copy) written under the old date-only name, so an existing
 * session keeps one file instead of gaining a second one under the new name.
 */
function migrateLegacyNote(outDir, oldBase, newBase) {
  if (oldBase === newBase) return;
  for (const ext of ['.md', '.jsonl']) {
    const from = path.join(outDir, `${oldBase}${ext}`);
    const to = path.join(outDir, `${newBase}${ext}`);
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    } catch { /* leave it; the sync below still writes the new name */ }
  }
}

/**
 * Load a session for the given agent and payload.
 * @returns {{session: import('./session.mjs').Session, raw: string|null}|null}
 */
function loadSession(agent, payload) {
  // OpenCode has no transcript file; the plugin passes the messages in the payload.
  if (agent === 'opencode') return { session: parseOpenCode(payload || {}), raw: null };
  const adapter = FILE_ADAPTERS[agent];
  if (!adapter) return null;
  const loc = adapter.locate(payload || {});
  let transcriptPath = loc.transcriptPath;
  if ((!transcriptPath || !fs.existsSync(transcriptPath)) && adapter.fallback) transcriptPath = adapter.fallback(loc);
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const session = adapter.parse(raw, { sessionId: loc.sessionId, cwd: loc.cwd });
  // The hook's cwd is where the agent is working; prefer it over the transcript's.
  if (loc.cwd) session.cwd = loc.cwd;
  if (loc.sessionId) session.sessionId = loc.sessionId;
  if (adapter.client) session.client = adapter.client(transcriptPath);
  if (adapter.times) adapter.times(session, transcriptPath);
  // Cursor runs user hooks from ~/.cursor; without a workspace root we'd write notes there.
  if (adapter.requireCwd && !session.cwd) return null;
  return { session, raw };
}

/**
 * Sync one session into <projectRoot>/<outputDir>.
 * @param {{agent: string, payload: object, projectRoot?: string, loaded?: {session: object, raw: string|null}}} args
 * @returns {Promise<{mdPath: string|null}>}
 */
export async function syncSession({ agent, payload, projectRoot, loaded }) {
  const result = loaded || loadSession(agent, payload);
  if (!result || !result.session.messages.length) return { mdPath: null };
  const { session, raw } = result;

  const root = projectRoot || projectRootFor(session.cwd || process.cwd());
  const config = loadConfig(root);
  if (config.redact) {
    for (const m of session.messages) {
      m.text = redact(m.text);
      if (m.thinking) m.thinking = redact(m.thinking);
    }
    if (session.compactSummary) session.compactSummary = redact(session.compactSummary);
  }

  const outDir = path.resolve(root, config.outputDir);
  const git = gitFacts(root, session.startedAt, outDir);
  if (git) session.git = config.redact ? { commits: git.commits.map((c) => redact(c)), files: git.files.map((f) => redact(f)) } : git;
  fs.mkdirSync(outDir, { recursive: true });
  const base = fileBaseName(session);
  const mdPath = path.join(outDir, `${base}.md`);
  migrateLegacyNote(outDir, legacyBaseName(session), base);
  writeAtomic(mdPath, toMarkdown(session, config));
  if (config.copyRaw && raw != null) {
    writeAtomic(path.join(outDir, `${base}.jsonl`), config.redact ? redactJsonl(raw) : raw);
  }
  return { mdPath };
}
