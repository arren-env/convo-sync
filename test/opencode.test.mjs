import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOpenCode } from '../scripts/lib/adapters/opencode.mjs';
import { install, uninstall, status } from '../scripts/lib/install.mjs';

const cli = fileURLToPath(new URL('../scripts/convo-sync.mjs', import.meta.url));

const messages = [
  { info: { role: 'user', time: { created: 1792994458378 } }, parts: [{ type: 'text', text: 'hi' }, { type: 'text', text: 'ctx', synthetic: true }] },
  {
    info: { role: 'assistant', time: { created: 1792994460490 } },
    parts: [
      { type: 'step-start' },
      { type: 'reasoning', text: 'hmm' },
      { type: 'tool', tool: 'bash', state: { status: 'completed' } },
      { type: 'text', text: 'hello' },
    ],
  },
];
const expected = [
  { role: 'user', text: 'hi' },
  { role: 'assistant', text: 'hello', thinking: 'hmm', tools: ['bash'] },
];

test('parseOpenCode maps text, reasoning and tool parts; skips synthetic text', () => {
  const s = parseOpenCode({ sessionId: 'ses_e8933c832ffe', cwd: '/p', messages });
  assert.equal(s.agent, 'opencode');
  assert.equal(s.sessionId, 'ses_e8933c832ffe');
  assert.equal(s.cwd, '/p');
  assert.equal(s.startedAt.getTime(), 1792994458378);
  assert.deepEqual(s.messages.map(({ at, ...m }) => m), expected);
});

test('parseOpenCode unwraps {data: [...]} and tolerates junk', () => {
  assert.deepEqual(parseOpenCode({ sessionId: 's', messages: { data: messages } }).messages.map(({ at, ...m }) => m), expected);
  assert.deepEqual(parseOpenCode({}).messages, []);
  assert.deepEqual(parseOpenCode({ messages: [null, { parts: 5 }] }).messages, []);
});

function env() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-oc-'));
  const projectRoot = path.join(tmp, 'proj');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  return { projectRoot, home, scriptPath: path.join(tmp, 'a b', 'convo-sync.mjs') };
}

test('opencode install renders the plugin with the script path; uninstall removes it', () => {
  const e = env();
  const r = install({ agent: 'opencode', scope: 'project', ...e });
  assert.equal(r.file, path.join(e.projectRoot, '.opencode', 'plugins', 'convo-sync.js'));
  const body = fs.readFileSync(r.file, 'utf8');
  assert.ok(body.includes(JSON.stringify(e.scriptPath.split(path.sep).join('/'))));
  assert.ok(!body.includes('__CONVO_SYNC_SCRIPT__'));
  assert.equal(install({ agent: 'opencode', scope: 'project', ...e }).changed, false);
  assert.equal(status(e).find((x) => x.agent === 'opencode' && x.scope === 'project').installed, true);
  assert.equal(install({ agent: 'opencode', scope: 'user', ...e }).file, path.join(e.home, '.config', 'opencode', 'plugins', 'convo-sync.js'));
  assert.equal(uninstall({ agent: 'opencode', scope: 'project', ...e }).changed, true);
  assert.ok(!fs.existsSync(r.file));
});

test('opencode uninstall leaves a foreign file with the same name alone', () => {
  const e = env();
  const f = path.join(e.projectRoot, '.opencode', 'plugins', 'convo-sync.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'export const Mine = 1;');
  assert.equal(uninstall({ agent: 'opencode', scope: 'project', ...e }).changed, false);
  assert.ok(fs.existsSync(f));
});

test('CLI sync --agent opencode --payload-file writes the note and deletes the payload', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-oc-'));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const payloadFile = path.join(tmp, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify({ sessionId: 'ses_abcdef123456', cwd: proj, messages: { data: messages } }));
  const r = spawnSync(process.execPath, [cli, 'sync', '--agent', 'opencode', '--payload-file', payloadFile], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}\n');
  const files = fs.readdirSync(path.join(proj, '.agents', 'conversations'));
  assert.deepEqual(files.filter((f) => f.endsWith('.md')).length, 1);
  assert.equal(files.filter((f) => f.endsWith('.jsonl')).length, 0);
  assert.ok(!fs.existsSync(payloadFile));
});

test('plugin template is valid JS that exports a ConvoSync plugin', async () => {
  const e = env();
  const r = install({ agent: 'opencode', scope: 'project', ...e });
  const mod = await import('file://' + r.file.split(path.sep).join('/'));
  assert.equal(typeof mod.ConvoSync, 'function');
  const hooks = await mod.ConvoSync({ client: {}, directory: e.projectRoot });
  assert.equal(typeof hooks.event, 'function');
  await hooks.event({ event: { type: 'message.updated', properties: {} } }); // ignored, must not throw
});
