// @convo-sync-plugin — installed by convo-sync. Remove with: convo-sync uninstall --agent opencode
// When a session finishes a turn, fetch its messages through OpenCode's plugin API and
// hand them to convo-sync, which writes the Markdown note.
//
// OpenCode 2.x (verified against @opencode/plugin 2.2.5): the loader requires
//   export default { id, setup(ctx) }
// Events come from ctx.event.subscribe({ types }) (async iterable, event.data.sessionID);
// messages from ctx.session.context({ sessionID }) -> Array<{ type: 'user'|'assistant', ... }>.
//
// OpenCode 1.x (verified against @opencode-ai/plugin 1.15.11): the named ConvoSync export,
// event.properties.sessionID and client.session.messages({ path: { id } }) -> { data }.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = "__CONVO_SYNC_SCRIPT__";

function handOff(id, cwd, messages) {
  const file = path.join(os.tmpdir(), `convo-sync-opencode-${id}-${Date.now()}.json`);
  // Unredacted conversation: owner-only, and removed if node can't be launched.
  fs.writeFileSync(file, JSON.stringify({ sessionId: id, cwd, messages }), { mode: 0o600 });
  const cleanup = () => { try { fs.rmSync(file, { force: true }); } catch {} };
  let child;
  try {
    child = spawn('node', [SCRIPT, 'sync', '--agent', 'opencode', '--payload-file', file], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
  } catch {
    cleanup();
    return;
  }
  child.on('error', cleanup);
  child.unref();
}

const list = (r) => (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : null);

// ---- OpenCode 2.x ----
const DONE = ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'];

export default {
  id: 'convo-sync',
  setup(ctx) {
    let stopped = false;
    let iterator;
    const onEvent = async (event) => {
      try {
        const id = event?.data?.sessionID;
        if (!id || !ctx?.session?.context) return;
        const messages = list(await ctx.session.context({ sessionID: id }));
        if (!messages) return;
        let cwd = event.location?.directory;
        if (!cwd) { try { cwd = (await ctx.session.get({ sessionID: id }))?.location?.directory; } catch {} }
        handOff(id, cwd || ctx.location?.directory || null, messages);
      } catch {
        // Never interfere with OpenCode.
      }
    };
    (async () => {
      try {
        iterator = ctx.event.subscribe({ types: DONE })[Symbol.asyncIterator]();
        while (!stopped) {
          const { value, done } = await iterator.next();
          if (done) break;
          onEvent(value);
        }
      } catch {
        // Subscription closed or unavailable; nothing to do.
      }
    })();
    return async () => {
      stopped = true;
      try { await iterator?.return?.(); } catch {}
    };
  },
};

// ---- OpenCode 1.x ----
export const ConvoSync = async ({ client, directory }) => ({
  event: async ({ event }) => {
    if (event?.type !== 'session.idle') return;
    try {
      const id = event.properties?.sessionID;
      if (!id || !client?.session?.messages) return;
      let messages = null;
      try { messages = list(await client.session.messages({ path: { id } })); } catch {}
      if (!messages) {
        try { messages = list(await client.session.messages({ sessionID: id })); } catch {}
      }
      if (!messages) return;
      handOff(id, directory, messages);
    } catch {
      // Never interfere with OpenCode.
    }
  },
});
