# convo-sync

Save each AI coding-agent session as a Markdown note in your project, after every turn. Switch agents later, ask to continue, and the next agent reads those notes instead of starting from zero.

Works with Claude Code, OpenAI Codex, Google Antigravity, OpenCode, and GitHub Copilot (CLI and VS Code chat). Runs on Windows, macOS, and Linux. Needs Node.js 22+. Stays local: no network calls, no automatic git commits.

## Install

1. Add the skill ([skills.sh](https://skills.sh)):

```bash
npx skills add arren-env/convo-sync
```

2. Set it up once on your machine. Ask your agent to “set up convo-sync”, or run:

```bash
node path/to/convo-sync/scripts/convo-sync.mjs install
```

One install covers every supported agent it finds. It merges into existing config, backs each edited file up once as `<file>.convo-sync.bak`, and skips agents that are not installed. Notes start appearing after the next completed turn. Restart an agent that was already open if its hook does not fire yet.

Check or remove later:

```bash
node path/to/convo-sync/scripts/convo-sync.mjs status
node path/to/convo-sync/scripts/convo-sync.mjs uninstall
```

Limit either command with `--agent <claude|codex|antigravity|opencode|copilot>`. Use `--scope project` to install only for the current repo (Claude Code, Antigravity, OpenCode, and Copilot via `.github/hooks/convo-sync.json`).

## Continue in another agent

Open a new chat in any supported agent, then run `/convo-sync` or ask “continue where we left off”.

The skill prints the newest saved conversations in this project (any agent), newest first, as short summaries. The agent gives you a catch-up, then asks what to continue with.

Prefer a fresh chat for catch-up: every extra tool call also re-sends earlier context in that thread.

## Where notes go

One file per session:

```text
.agents/conversations/2026-11-05_claude_6ca14529.md
```

Each note includes:

- Frontmatter: `title`, `agent`, `client` (Copilot: `cli` or `vscode`), `session_id`, `project`, `created`, `updated`, `tags`
- A `## Summary` block rebuilt on every sync (no model call): goal, latest status, commits since start, uncommitted files, and compacted-context text when the agent wrote one
- The turn transcript as `## User` / `## Assistant` sections

Optional: set `"copyRaw": true` to keep a redacted `.jsonl` transcript beside the note. OpenCode has no source transcript, so it never gets one.

## Optional settings

Create `.convo-sync.json` at the project root only when you want different behaviour:

```json
{
  "outputDir": ".agents/conversations",
  "redact": true,
  "copyRaw": false,
  "includeThinking": false,
  "includeTools": false
}
```

`outputDir` can be a path relative to the project root, or an absolute path such as an Obsidian vault folder.

## Privacy

Transcripts often contain secrets. By default, convo-sync redacts common patterns:

- API keys (`sk-…`)
- GitHub, AWS, Slack, and Google keys
- Bearer tokens
- PEM private keys
- `password=` / `api_key:`-style assignments

Redaction is best-effort. Review notes before you commit them, or add the output folder to `.gitignore`.

## What the installer changes

| Agent | Trigger | File edited |
| --- | --- | --- |
| Claude Code | `Stop` hook | `~/.claude/settings.json` |
| Codex | `notify` command | `~/.codex/config.toml` |
| Antigravity | `PostInvocation` hook | `~/.gemini/config/hooks.json` |
| OpenCode | plugin, `session.idle` | `~/.config/opencode/plugins/convo-sync.js` |
| GitHub Copilot (CLI and VS Code chat) | `agentStop` hook | `~/.copilot/hooks/convo-sync.json` (`$COPILOT_HOME/hooks` if set) |

Codex allows only one `notify` command. If you already have one, the installer leaves it alone and says so.

## Limitations

- Transcript formats are internal to each agent. An update can change them. Parsers skip unknown data and never block the agent, but a note may be incomplete until the adapter is updated.
- Claude Code subagent (sidechain) messages and Codex history replayed after compaction are left out.
- Past sessions are not imported. Notes start from the first turn after install.
- Live-verified on Windows: Antigravity CLI, Codex (`notify`), and Copilot CLI 1.0.105 (`agentStop`). Claude Code, OpenCode, and Copilot in VS Code are verified on real transcripts and tests, but not yet in a live hook run.
- Copilot in VS Code works for the **Copilot** session target. The older **Local** target uses a different transcript format and is not supported.

## Troubleshooting

Hooks always exit 0 and print `{}`, so they never interrupt your agent. Errors go to `<OS temp dir>/convo-sync.log`. Set `CONVO_SYNC_DEBUG=1` to log every sync.

## Development

```bash
node --test
```

## License

MIT
