// Facts about the project's code changes, read from git so they work the same for every agent.
// Runs inside agent hooks after every turn: every call is bounded, takes no locks,
// runs no repo-configured helpers, and any failure yields null or an empty list.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX = 20;
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function run(root, args) {
  // --no-optional-locks: never take index.lock, so the user's own git commands can't collide.
  // core.fsmonitor=false: a repo's config can't make this hook run an arbitrary command.
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd: root, timeout: 3000, encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function real(p) {
  let r;
  try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); }
  r = r.replace(/\\/g, '/').replace(/\/$/, '');
  return CASE_INSENSITIVE ? r.toLowerCase() : r;
}

const lines = (text) => text.split('\n').filter((l) => l.trim());

/**
 * Commits made since `since` and uncommitted changes, excluding the notes folder itself.
 * @param {string} root project root (must be the top of a git work tree)
 * @param {Date|null} since session start; null lists the latest commits
 * @param {string} excludeDir absolute path of the notes folder
 * @returns {{commits: string[], files: string[]}|null} commits as "<hash> <subject>",
 *   files as `git status --porcelain` lines; null when not a git repo or git fails
 */
export function gitFacts(root, since, excludeDir) {
  try {
    // Refuse a parent repository: only report on the repo this project root is the top of.
    // Compare real paths so junctions, symlinks and short names don't hide the repo.
    if (real(run(root, ['rev-parse', '--show-toplevel']).trim()) !== real(root)) return null;
  } catch {
    return null;
  }

  let commits = [];
  try {
    const log = ['log', '--format=%h %s', `-n${MAX}`];
    if (since) log.push(`--since=${since.toISOString()}`);
    commits = lines(run(root, log)).map((l) => l.trim());
  } catch { /* a repo with no commits yet: git log fails, but status still works */ }

  let files = [];
  try {
    const rel = path.relative(real(root), real(excludeDir));
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : null;
    const fold = (s) => (CASE_INSENSITIVE ? s.toLowerCase() : s);
    const inNotes = (file) => inside && (fold(file) === inside || fold(file).startsWith(`${inside}/`));
    files = lines(run(root, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall']))
      .filter((l) => !inNotes(l.slice(3).replace(/^"|"$/g, '')))
      .slice(0, MAX);
  } catch { /* slow or huge repo: keep the commits, skip the file list */ }

  return { commits, files };
}
