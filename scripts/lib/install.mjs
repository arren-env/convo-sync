// Writes / removes convo-sync hook entries in each agent's config, merging with what's there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'convo-sync';
const GROUP = 'convo-sync'; // Antigravity hook group name
const PLUGIN_MARKER = '@convo-sync-plugin';
const PLUGIN_TEMPLATE = fileURLToPath(new URL('../opencode-plugin.js', import.meta.url));

export const INSTALLABLE = ['claude', 'codex', 'antigravity', 'opencode', 'copilot', 'cursor'];

export function hookCommand(scriptPath, agent) {
  // Forward slashes work for Node on every OS. Quote only when needed: Antigravity on
  // Windows passes double quotes through to node literally (verified live), so a quoted
  // path breaks there. Paths with spaces still need quotes for bash/sh/cmd.
  const p = String(scriptPath).replace(/\\/g, '/');
  return `node ${/\s/.test(p) ? `"${p}"` : p} sync --agent ${agent}`;
}

/** Agent home folders; an agent counts as present when its folder exists. */
const AGENT_HOMES = {
  claude: (home) => path.join(home, '.claude'),
  codex: (home) => process.env.CODEX_HOME || path.join(home, '.codex'),
  antigravity: (home) => path.join(home, '.gemini'),
  opencode: (home) => path.join(home, '.config', 'opencode'),
  copilot: (home) => process.env.COPILOT_HOME || path.join(home, '.copilot'),
  cursor: (home) => path.join(home, '.cursor'),
};

/** Agents installed on this machine, in INSTALLABLE order. */
export function detectAgents(home) {
  return INSTALLABLE.filter((a) => fs.existsSync(AGENT_HOMES[a](home)));
}

/** Config file for an agent + scope. Codex is always user-level (~/.codex/config.toml `notify`). */
export function targetFile(agent, scope, projectRoot, home) {
  const user = scope === 'user';
  switch (agent) {
    case 'claude': return user ? path.join(home, '.claude', 'settings.json') : path.join(projectRoot, '.claude', 'settings.local.json');
    case 'codex': return path.join(AGENT_HOMES.codex(home), 'config.toml');
    case 'antigravity': return user ? path.join(home, '.gemini', 'config', 'hooks.json') : path.join(projectRoot, '.agents', 'hooks.json');
    case 'opencode': return user ? path.join(home, '.config', 'opencode', 'plugins', 'convo-sync.js') : path.join(projectRoot, '.opencode', 'plugins', 'convo-sync.js');
    // Copilot CLI and VS Code (Copilot harness) both read ~/.copilot/hooks/*.json and .github/hooks/*.json.
    case 'copilot': return user ? path.join(AGENT_HOMES.copilot(home), 'hooks', 'convo-sync.json') : path.join(projectRoot, '.github', 'hooks', 'convo-sync.json');
    // Cursor's hooks file is shared with the user's other hooks, so we merge into it.
    case 'cursor': return user ? path.join(home, '.cursor', 'hooks.json') : path.join(projectRoot, '.cursor', 'hooks.json');
    default: throw new Error(`unknown agent: ${agent}`);
  }
}

// ---- OpenCode: a plugin file rendered from scripts/opencode-plugin.js ----
function renderPlugin(scriptPath) {
  const template = fs.readFileSync(PLUGIN_TEMPLATE, 'utf8');
  return template.replace('"__CONVO_SYNC_SCRIPT__"', JSON.stringify(String(scriptPath).replace(/\\/g, '/')));
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

const pluginFile = {
  has: (file) => (readText(file) || '').includes(PLUGIN_MARKER),
  install(file, scriptPath) {
    const existing = readText(file);
    if (existing != null && !existing.includes(PLUGIN_MARKER)) {
      return { file, changed: false, note: `${file} exists and isn't a convo-sync plugin; left it untouched.` };
    }
    const body = renderPlugin(scriptPath);
    if (existing === body) return { file, changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    return { file, changed: true };
  },
  uninstall(file) {
    if (!pluginFile.has(file)) return { file, changed: false };
    fs.rmSync(file);
    return { file, changed: true };
  },
};

const isOurs = (h) => typeof h?.command === 'string' && h.command.includes(MARKER);

// ---- Claude Code / Codex: { hooks: { Stop: [ { hooks: [handler] } ] } } ----
const stopStyle = {
  has(cfg) {
    return (cfg.hooks?.Stop || []).some((g) => (g?.hooks || []).some(isOurs));
  },
  add(cfg, command) {
    cfg.hooks ??= {};
    cfg.hooks.Stop ??= [];
    cfg.hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 30 }] });
  },
  remove(cfg) {
    const stop = cfg.hooks?.Stop;
    if (!Array.isArray(stop)) return;
    cfg.hooks.Stop = stop
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length);
    if (!cfg.hooks.Stop.length) delete cfg.hooks.Stop;
    if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
  },
};

// ---- Antigravity: { "<group>": { enabled, PostInvocation: [handler] } } ----
const antigravityStyle = {
  has(cfg) {
    return (cfg[GROUP]?.PostInvocation || []).some(isOurs);
  },
  add(cfg, command) {
    cfg[GROUP] = { enabled: true, PostInvocation: [{ type: 'command', command, timeout: 15 }] };
  },
  remove(cfg) {
    delete cfg[GROUP];
  },
};

// ---- Cursor: { version: 1, hooks: { stop: [handler] } } in .cursor/hooks.json ----
const cursorStyle = {
  has(cfg) {
    return (cfg.hooks?.stop || []).some(isOurs);
  },
  add(cfg, command) {
    cfg.version ??= 1;
    cfg.hooks ??= {};
    cfg.hooks.stop ??= [];
    cfg.hooks.stop.push({ command, timeout: 30 });
  },
  remove(cfg) {
    const stop = cfg.hooks?.stop;
    if (!Array.isArray(stop)) return;
    cfg.hooks.stop = stop.filter((h) => !isOurs(h));
    if (!cfg.hooks.stop.length) delete cfg.hooks.stop;
    if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
    // Only a version key left means the file held nothing but our hook.
    if (Object.keys(cfg).length === 1 && 'version' in cfg) delete cfg.version;
  },
};

const STYLES = { claude: stopStyle, antigravity: antigravityStyle, cursor: cursorStyle };

// ---- Codex: top-level `notify = [...]` in ~/.codex/config.toml ----
// Codex Stop hooks did not fire in live tests (Codex 0.164, Windows); `notify` did, and
// it runs argv directly (no shell), so paths with spaces need no quoting.
const NOTIFY_LINE = /^notify\s*=.*$/m;

/** Text before the first [table] header: the only place a top-level key can live. */
function topLevel(text) {
  const m = text.match(/^\s*\[/m);
  return m ? text.slice(0, m.index) : text;
}

const codexNotify = {
  line: (scriptPath) => `notify = ${JSON.stringify(['node', String(scriptPath).replace(/\\/g, '/'), 'sync', '--agent', 'codex'])}`,
  has(file) {
    const top = topLevel((readText(file) || '').replace(/^﻿/, ''));
    return (top.match(NOTIFY_LINE)?.[0] || '').includes(MARKER);
  },
  install(file, scriptPath) {
    const existing = readText(file);
    const text = (existing || '').replace(/^﻿/, '');
    const wanted = codexNotify.line(scriptPath);
    const current = topLevel(text).match(NOTIFY_LINE)?.[0];
    let next;
    if (current && !current.includes(MARKER)) {
      return {
        file, changed: false,
        note: `~/.codex/config.toml already has its own notify command, which Codex allows only one of. Left it untouched; Codex conversations won't be synced until it is removed or replaced with:\n  ${wanted}`,
      };
    }
    if (current === wanted) return { file, changed: false };
    if (current) next = text.replace(current, wanted);
    else next = text ? `${wanted}\n\n${text}` : `${wanted}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const backup = `${file}.convo-sync.bak`;
    if (existing != null && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, next, 'utf8');
    return { file, changed: true };
  },
  uninstall(file) {
    if (!codexNotify.has(file)) return { file, changed: false };
    const text = readText(file);
    fs.writeFileSync(file, text.replace(/^notify\s*=.*convo-sync.*\r?\n(\r?\n)?/m, ''), 'utf8');
    return { file, changed: true };
  },
};

// ---- Copilot: a hook file of our own, { version: 1, hooks: { agentStop: [handler] } } ----
const copilotHookFile = {
  has(file) {
    try { return (readConfig(file).cfg.hooks?.agentStop || []).some(isOurs); } catch { return false; }
  },
  install(file, scriptPath) {
    const wanted = { version: 1, hooks: { agentStop: [{ type: 'command', command: hookCommand(scriptPath, 'copilot'), timeoutSec: 15 }] } };
    const body = JSON.stringify(wanted, null, 2) + '\n';
    const existing = readText(file);
    if (existing != null && !copilotHookFile.has(file)) {
      return { file, changed: false, note: `${file} exists and isn't a convo-sync hook file; left it untouched.` };
    }
    if (existing === body) return { file, changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    return { file, changed: true };
  },
  uninstall(file) {
    if (!copilotHookFile.has(file)) return { file, changed: false };
    fs.rmSync(file);
    return { file, changed: true };
  },
};

/** Remove our entry from an old-style Codex hooks.json (earlier versions wrote one). */
function cleanLegacyCodexHooks(file) {
  try {
    const { cfg } = readConfig(file);
    if (!stopStyle.has(cfg)) return false;
    stopStyle.remove(cfg);
    if (Object.keys(cfg).length) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    else fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

function readConfig(file) {
  if (!fs.existsSync(file)) return { cfg: {}, existed: false };
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return { cfg: {}, existed: true };
  const cfg = JSON.parse(text); // throws on invalid JSON
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('not an object');
  return { cfg, existed: true };
}

function writeConfig(file, cfg, existed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}.convo-sync.bak`;
  if (existed && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/**
 * T3 Code runs Antigravity with GEMINI_HOME = ~/.t3/userdata/providers/antigravity/<hash>.
 * It links skills from ~/.gemini but deliberately leaves hooks out of that profile, so the
 * user-level ~/.gemini/config/hooks.json never fires for T3 sessions. Install into each
 * profile's config/hooks.json as well.
 */
export function t3AntigravityHookFiles(home) {
  const root = path.join(home, '.t3', 'userdata', 'providers', 'antigravity');
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(root, d.name, 'config', 'hooks.json'));
  } catch {
    return [];
  }
}

function editFile(file, mutate) {
  let cfg, existed;
  try {
    ({ cfg, existed } = readConfig(file));
  } catch {
    return { file, changed: false, note: `${file} is not valid JSON; left it untouched. Fix it and run install again.` };
  }
  const changed = mutate(cfg, existed);
  if (changed) {
    // A hook file that only held our entry is removed rather than left as "{}".
    if (existed && !Object.keys(cfg).length) fs.rmSync(file);
    else writeConfig(file, cfg, existed);
  }
  return { file, changed };
}

function edit({ agent, scope, projectRoot, home }, mutate) {
  return editFile(targetFile(agent, scope, projectRoot, home), mutate);
}

function applyAntigravityStyle(cfg, scriptPath) {
  const command = hookCommand(scriptPath, 'antigravity');
  if (antigravityStyle.has(cfg)) {
    const before = JSON.stringify(cfg);
    antigravityStyle.remove(cfg);
    antigravityStyle.add(cfg, command);
    return JSON.stringify(cfg) !== before;
  }
  antigravityStyle.add(cfg, command);
  return true;
}

/** @returns {{file: string, changed: boolean, note?: string}} */
export function install({ agent, scope = 'user', projectRoot, home, scriptPath }) {
  if (agent === 'opencode') return pluginFile.install(targetFile(agent, scope, projectRoot, home), scriptPath);
  if (agent === 'codex') return codexNotify.install(targetFile(agent, scope, projectRoot, home), scriptPath);
  if (agent === 'copilot') return copilotHookFile.install(targetFile(agent, scope, projectRoot, home), scriptPath);
  if (agent === 'antigravity') {
    const primary = editFile(targetFile(agent, scope, projectRoot, home), (cfg) => applyAntigravityStyle(cfg, scriptPath));
    const notes = [];
    if (primary.note) notes.push(primary.note);
    let changed = primary.changed;
    if (scope === 'user') {
      const t3Files = t3AntigravityHookFiles(home);
      let t3Changed = 0;
      for (const file of t3Files) {
        const r = editFile(file, (cfg) => applyAntigravityStyle(cfg, scriptPath));
        if (r.note) notes.push(r.note);
        if (r.changed) { changed = true; t3Changed++; }
      }
      if (t3Files.length) {
        notes.push(`Also ${t3Changed ? 'installed' : 'already installed'} in ${t3Files.length} T3 Code Antigravity profile(s) under ~/.t3/userdata/providers/antigravity (T3 keeps ~/.gemini hooks out of those profiles). Re-run install after adding a new Antigravity account in T3.`);
      }
    }
    if (!notes.length && /\s/.test(String(scriptPath))) {
      notes.push('The convo-sync path contains a space. Antigravity on Windows passes quotes to node literally, so this hook may fail there. Install the skill to a path without spaces.');
    }
    return { file: primary.file, changed, ...(notes.length ? { note: notes.join('\n') } : {}) };
  }
  const style = STYLES[agent];
  if (!style) throw new Error(`unknown agent: ${agent}`);
  const result = edit({ agent, scope, projectRoot, home }, (cfg) => {
    const command = hookCommand(scriptPath, agent);
    if (style.has(cfg)) {
      // Already installed; refresh the command if the script moved.
      const before = JSON.stringify(cfg);
      style.remove(cfg);
      style.add(cfg, command);
      return JSON.stringify(cfg) !== before;
    }
    style.add(cfg, command);
    return true;
  });
  return result;
}

/** @returns {{file: string, changed: boolean, note?: string}} */
export function uninstall({ agent, scope = 'user', projectRoot, home }) {
  if (agent === 'opencode') return pluginFile.uninstall(targetFile(agent, scope, projectRoot, home));
  if (agent === 'copilot') return copilotHookFile.uninstall(targetFile(agent, scope, projectRoot, home));
  if (agent === 'codex') {
    const legacy = [path.join(projectRoot, '.codex', 'hooks.json'), path.join(AGENT_HOMES.codex(home), 'hooks.json')]
      .map(cleanLegacyCodexHooks).some(Boolean);
    const r = codexNotify.uninstall(targetFile(agent, scope, projectRoot, home));
    return { ...r, changed: r.changed || legacy };
  }
  if (agent === 'antigravity') {
    const file = targetFile(agent, scope, projectRoot, home);
    let changed = false;
    const files = scope === 'user' ? [file, ...t3AntigravityHookFiles(home)] : [file];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      const r = editFile(f, (cfg) => {
        if (!antigravityStyle.has(cfg)) return false;
        antigravityStyle.remove(cfg);
        return true;
      });
      if (r.changed) changed = true;
    }
    return { file, changed };
  }
  const style = STYLES[agent];
  if (!style) throw new Error(`unknown agent: ${agent}`);
  const file = targetFile(agent, scope, projectRoot, home);
  if (!fs.existsSync(file)) return { file, changed: false };
  return edit({ agent, scope, projectRoot, home }, (cfg) => {
    if (!style.has(cfg)) return false;
    style.remove(cfg);
    return true;
  });
}

/** @returns {Array<{agent: string, scope: string, file: string, installed: boolean}>} */
export function status({ projectRoot, home }) {
  const rows = [];
  for (const agent of INSTALLABLE) {
    for (const scope of agent === 'codex' ? ['user'] : ['project', 'user']) {
      const file = targetFile(agent, scope, projectRoot, home);
      let installed = false;
      if (agent === 'opencode') installed = pluginFile.has(file);
      else if (agent === 'codex') installed = codexNotify.has(file);
      else if (agent === 'copilot') installed = copilotHookFile.has(file);
      else try { installed = STYLES[agent].has(readConfig(file).cfg); } catch { /* unreadable */ }
      rows.push({ agent, scope, file, installed });
    }
    if (agent === 'antigravity') {
      for (const file of t3AntigravityHookFiles(home)) {
        let installed = false;
        try { installed = antigravityStyle.has(readConfig(file).cfg); } catch { /* unreadable */ }
        rows.push({ agent, scope: 't3', file, installed });
      }
    }
  }
  return rows;
}
