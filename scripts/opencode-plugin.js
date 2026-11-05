// @convo-sync-plugin — installed by convo-sync. Remove with: convo-sync uninstall --agent opencode
// When a session goes idle (the agent finished its turn), fetch its messages through
// OpenCode's client and hand them to convo-sync, which writes the Markdown note.
// Verified against @opencode-ai/plugin 1.15.11: event.properties.sessionID and
// client.session.messages({ path: { id } }) -> { data: Array<{ info, parts }> }.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = "__CONVO_SYNC_SCRIPT__";

export const ConvoSync = async ({ client, directory }) => ({
  event: async ({ event }) => {
    if (event?.type !== 'session.idle') return;
    try {
      const id = event.properties?.sessionID;
      if (!id || !client?.session?.messages) return;
      // OpenCode 1.x client takes { path: { id } }; the 2.x client takes { sessionID }.
      const list = (r) => (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : null);
      let messages = null;
      try { messages = list(await client.session.messages({ path: { id } })); } catch {}
      if (!messages) {
        try { messages = list(await client.session.messages({ sessionID: id })); } catch {}
      }
      if (!messages) return;
      const file = path.join(os.tmpdir(), `convo-sync-opencode-${id}-${Date.now()}.json`);
      // Unredacted conversation: owner-only, and removed if node can't be launched.
      fs.writeFileSync(file, JSON.stringify({ sessionId: id, cwd: directory, messages }), { mode: 0o600 });
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
    } catch {
      // Never interfere with OpenCode.
    }
  },
});
