# convo-sync

Save your AI coding-agent conversations as Markdown notes inside your project, automatically, after every turn. They can be read and searched in Obsidian, or versioned with your code.

- **Agents:** Claude Code, OpenAI Codex, Google Antigravity, OpenCode, GitHub Copilot (CLI and VS Code chat)
- **OS:** Windows, macOS, Linux
- **Runtime:** Node.js 22+, no dependencies
- **Local only:** no network calls, no git commits

## Install

As a skill (any agent supported by [skills.sh](https://skills.sh)):

```bash
npx skills add <owner>/convo-sync
```

Then ask your agent to "set up convo-sync", or run it yourself once:

```bash
node path/to/convo-sync/scripts/convo-sync.mjs install
```

That's the whole setup. It's **one install per machine**, it covers every agent it finds, and it works in every project. No files are added to your projects except the notes themselves, and you don't need to edit any config by hand.

| Agent | Trigger | File the installer edits |
|---|---|---|
| Claude Code | `Stop` hook | `~/.claude/settings.json` |
| Codex | `notify` command | `~/.codex/config.toml` ¹ |
| Antigravity | `PostInvocation` hook | `~/.gemini/config/hooks.json` |
| OpenCode | plugin, `session.idle` | `~/.config/opencode/plugins/convo-sync.js` |
| GitHub Copilot (CLI and VS Code chat) | `agentStop` hook | `~/.copilot/hooks/convo-sync.json` (`$COPILOT_HOME/hooks` if set) |

¹ Codex allows only one `notify` command. If you already have your own, the installer leaves it alone and says so.

The installer merges into existing config and keeps your other settings. It backs up each file once to `<file>.convo-sync.bak`, and running it again does no harm. Agents that aren't installed on the machine are skipped.

Other commands:

```bash
node scripts/convo-sync.mjs status
node scripts/convo-sync.mjs uninstall
```

Use `--agent <name>` to limit a command to one agent. Use `--scope project` to install for only the current project (Claude Code, Antigravity, OpenCode, and Copilot via `.github/hooks/convo-sync.json`; Copilot only loads repository hooks in folders you trust).

## Continue in another agent

Switch agents and run `/convo-sync` (or ask "continue where we left off"). The skill runs:

```bash
node scripts/convo-sync.mjs context
```

This prints the newest conversations saved in the current project, from any agent, newest first: each one's first request plus its latest messages. The output is capped at about 12,000 characters (`--max-chars <n>`, `--limit <n>` to change), so loading context costs roughly the same however long the earlier conversations were. The agent reads that and gives you a short catch-up before continuing.

## Output

One file per session: `.agents/conversations/2026-11-05_claude_6ca14529.md`.

- Frontmatter: `title`, `agent`, `client` (Copilot only: `cli` or `vscode`), `session_id`, `project`, `created`, `updated`, `tags: [ai-chat, <agent>]`.
- Body: `## User` / `## Assistant` sections.
- Optionally (`"copyRaw": true`), a redacted `.jsonl` copy of the source transcript sits next to the note. OpenCode has no source transcript, so it never gets one.

Settings go in `.convo-sync.json` at the project root:

```json
{
  "outputDir": ".agents/conversations",
  "redact": true,
  "copyRaw": false,
  "includeThinking": false,
  "includeTools": false
}
```

## Privacy

Agent transcripts often contain secrets: pasted `.env` files, tokens, internal URLs. convo-sync redacts common secret patterns by default:

- API keys (`sk-…`)
- GitHub, AWS, Slack and Google keys
- Bearer tokens
- PEM private keys
- `password=` / `api_key:`-style assignments

This is **best-effort**. Review notes before committing them to a public repository, or add the output folder to `.gitignore`.

## Limitations

- Transcript formats are internal to each agent and undocumented (except Claude's file location). An agent update can change them. Parsers skip anything they don't recognise and never block the agent, but a note may come out incomplete until the adapter is updated.
- Claude Code subagent (sidechain) messages and Codex history replayed after compaction are left out.
- Past sessions aren't imported. Notes are written from the first turn after install.
- Live-verified on Windows: Antigravity CLI, Codex (`notify`) and Copilot CLI 1.0.105 (`agentStop`). Claude Code, OpenCode and Copilot in VS Code are verified on real transcripts and by tests, but not yet in a live hook run.
- Copilot in VS Code is supported for the **Copilot** session target (the shared Copilot runtime). The older **Local** target uses a different, undocumented transcript format and isn't supported; its turns produce no note.

## Troubleshooting

The hook always exits 0 and prints `{}`, so it never interrupts your agent. Errors go to `<OS temp dir>/convo-sync.log`. Set `CONVO_SYNC_DEBUG=1` to log every sync.

## Development

```bash
node --test
```

## License

MIT
