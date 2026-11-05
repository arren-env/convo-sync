#!/usr/bin/env node
// convo-sync: save AI agent conversations as Markdown notes in your project.
// Usage:
//   node convo-sync.mjs install   [--agent <name|all>] [--scope user|project]
//   node convo-sync.mjs uninstall [--agent <name|all>] [--scope user|project]
//   node convo-sync.mjs status
//   node convo-sync.mjs context   [--limit <n>] [--max-chars <n>]
//   node convo-sync.mjs sync --agent <claude|codex|antigravity|opencode|copilot> [--payload-file <f>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSession, projectRootFor, AGENTS } from './lib/sync.mjs';
import { install, uninstall, status, detectAgents, INSTALLABLE } from './lib/install.mjs';
import { buildContext } from './lib/context.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const LOG = path.join(os.tmpdir(), 'convo-sync.log');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      flags[key] = next && !next.startsWith('--') ? (i++, next) : true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { command, flags, positional };
}

function log(message) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`); } catch { /* ignore */ }
}

/** Read all of stdin, giving up after timeoutMs so a hook can never hang. */
function readStdin(timeoutMs = 2000) {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const done = () => { clearTimeout(timer); process.stdin.removeAllListeners(); process.stdin.pause(); resolve(data); };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

function parseJson(text) {
  try { return JSON.parse(String(text).replace(/^﻿/, '')); } catch { return {}; }
}

async function runSync(flags, positional) {
  try {
    const agent = String(flags.agent || '');
    if (!AGENTS.includes(agent)) throw new Error(`unknown agent: ${agent}`);
    let payload;
    const argvJson = positional.findLast((p) => p.trim().startsWith('{'));
    if (argvJson) {
      // Codex `notify` passes its JSON payload as the last argument.
      payload = parseJson(argvJson);
    } else if (typeof flags['payload-file'] === 'string') {
      const file = flags['payload-file'];
      try {
        payload = parseJson(fs.readFileSync(file, 'utf8'));
      } finally {
        // Payload files are temp handoffs from the OpenCode plugin; never leave them behind.
        try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      }
    } else {
      payload = parseJson(await readStdin());
    }
    const { mdPath } = await syncSession({ agent, payload });
    if (process.env.CONVO_SYNC_DEBUG) log(`sync ${agent} -> ${mdPath}`);
  } catch (err) {
    log(`sync error: ${err?.stack || err}`);
  }
  // Hook contract: always valid JSON on stdout, always exit 0.
  process.stdout.write('{}\n');
  process.exit(0);
}

function usage() {
  process.stdout.write(
    'convo-sync <command>\n' +
    '  install   [--agent <name|all>] [--scope user|project]   default: all detected agents, user scope (every project)\n' +
    '  uninstall [--agent <name|all>] [--scope user|project]\n' +
    '  status\n' +
    '  context   [--limit <n>] [--max-chars <n>]   print the latest saved conversations in this project\n' +
    '  sync --agent <claude|codex|antigravity|opencode|copilot> [--payload-file <f>]   (called by the hooks)\n',
  );
}

function runInstall(command, flags) {
  const scope = flags.scope === 'project' ? 'project' : 'user';
  const home = os.homedir();
  const requested = String(flags.agent || 'all');
  // install all = agents present on this machine; uninstall all = every agent we know.
  const agents = requested === 'all' ? (command === 'install' ? detectAgents(home) : INSTALLABLE) : [requested];
  if (!agents.every((a) => INSTALLABLE.includes(a))) {
    process.stderr.write(`unknown agent: ${requested} (use ${INSTALLABLE.join(', ')} or all)\n`);
    process.exit(1);
  }
  if (!agents.length) {
    process.stdout.write('No supported agents found (looked for ~/.claude, ~/.codex, ~/.gemini, ~/.config/opencode, ~/.copilot).\n');
    return;
  }
  const ctx = { scope, projectRoot: projectRootFor(process.cwd()), home, scriptPath: SCRIPT_PATH };
  for (const agent of agents) {
    const r = command === 'install' ? install({ agent, ...ctx }) : uninstall({ agent, ...ctx });
    const verb = command === 'install' ? (r.changed ? 'installed' : 'already installed') : (r.changed ? 'removed' : 'not installed');
    process.stdout.write(`${agent} (${agent === 'codex' ? 'user' : scope}): ${verb} -> ${r.file}\n`);
    if (r.note) process.stdout.write(`  note: ${r.note.replace(/\n/g, '\n  ')}\n`);
  }
}

function runStatus() {
  for (const r of status({ projectRoot: projectRootFor(process.cwd()), home: os.homedir() })) {
    process.stdout.write(`${r.agent.padEnd(12)} ${r.scope.padEnd(8)} ${r.installed ? 'installed' : 'not installed'}  ${r.file}\n`);
  }
}

const { command, flags, positional } = parseArgs(process.argv.slice(2));
if (command === 'sync') {
  await runSync(flags, positional);
} else if (command === 'install' || command === 'uninstall') {
  runInstall(command, flags);
} else if (command === 'status') {
  runStatus();
} else if (command === 'context') {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  process.stdout.write(buildContext({
    projectRoot: projectRootFor(process.cwd()),
    limit: num(flags.limit, 3),
    maxChars: num(flags['max-chars'], 12000),
  }));
} else {
  usage();
  process.exit(command ? 1 : 0);
}
