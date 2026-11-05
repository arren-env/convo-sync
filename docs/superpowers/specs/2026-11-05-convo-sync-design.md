# convo-sync — Design

## Intent

The user's own AI-agent conversations should be saved automatically as readable Markdown inside the project they belong to, so the chats can be searched in Obsidian and versioned with the code. This should work for every agent they use (Antigravity, Claude Code, Codex, OpenCode) on Windows, macOS and Linux. It is published as a skill on skills.sh, so `npx skills add <owner>/convo-sync` installs it.

A working prototype exists (`Preparation/obsidian/.agents/sync-convo.ps1`). It handles Antigravity only, is Windows-only, and overwrites a single `active-session.md`.

## Goals

- One cross-platform Node.js script (`scripts/convo-sync.mjs`) using built-in modules only, Node ≥ 22.
- **Automatic.** After each agent turn a hook (or an OpenCode plugin) runs `sync` with no user action.
- **One Markdown file per session:** `<outputDir>/YYYY-MM-DD_<agent>_<id8>.md`. Each sync rewrites the whole file, so syncing twice is harmless.
- **Raw JSONL copy (opt-in, revised after review).** With `copyRaw: true`, `<same-name>.jsonl` holds the redacted source transcript. OpenCode has no source file, so it gets none.
- **Installer.** `install --agent <name|all> --scope <project|user>` writes each agent's hook config and merges it into whatever is already there. `uninstall` removes only our entries.
- **`SKILL.md`** tells any agent how to install, sync manually, and check status.
- **Redaction on by default:** common secret patterns are replaced with `[REDACTED]`.
- **Optional config file** `.convo-sync.json` in the project root: `{ "outputDir": ".agents/conversations", "redact": true, "copyRaw": false, "includeThinking": false, "includeTools": false }`.

## Non-goals

- No git commits or pushes; the tool only writes files (user decision).
- No cloud services, no network calls, no npm dependencies.
- No Cursor or Aider adapters in v1. Aider already writes its own Markdown.

## Anti-goals (a failure even if it "works")

- The hook slows down or breaks the agent. The hook must always exit 0 and print `{}`, never block, and finish quickly.
- Secrets end up in the vault or git because redaction was off by default.
- One session overwrites another session's file.
- Existing hook or settings entries the user already had are lost.

## Decided by the user

- Name `convo-sync`; Node.js with no dependencies; default output `<project>/.agents/conversations/`, configurable; no automatic git commits.

## Facts the design rests on (checked 2026-11-05 against local files and docs)

| Agent | Trigger | Payload | Transcript |
|---|---|---|---|
| Claude Code | `Stop` hook in `.claude/settings.json` / `~/.claude/settings.json` | stdin JSON: `session_id`, `transcript_path`, `cwd` | `~/.claude/projects/<enc>/<session>.jsonl`; lines `{type:"user"\|"assistant", message:{content}}` |
| Codex | `Stop` hook in `.codex/hooks.json` / `~/.codex/hooks.json` (requires `features.hooks`) | stdin JSON: `session_id`, `transcript_path` (may be null), `cwd` | `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`; lines `{type:"response_item", payload:{type:"message", role, content:[{type:"input_text"\|"output_text", text}]}}` |
| Antigravity | `PostInvocation` in `.agents/hooks.json` / `~/.gemini/config/hooks.json` | stdin JSON: `conversationId`, `transcriptPath`, `workspacePaths[]` | `~/.gemini/antigravity*/brain/<id>/.system_generated/logs/transcript.jsonl`; lines `{source:"USER_EXPLICIT", type:"USER_INPUT", content}` / `{source:"MODEL", type:"PLANNER_RESPONSE", content?, thinking?}` |
| OpenCode | plugin file `.opencode/plugins/convo-sync.js` / `~/.config/opencode/plugins/`, event `session.idle` | plugin calls our script with the session's messages | SQLite `opencode.db`, two schema generations, so the plugin uses OpenCode's own client API instead of reading the DB |

Every transcript format except Claude's file paths is unofficial and has changed between versions. Parsers must skip unknown lines and must never throw.

## Left to the builder

- The exact redaction regex list. Minimum coverage: OpenAI/Anthropic `sk-…`, GitHub `gh[pousr]_…`, AWS `AKIA…`, `Bearer …`, PEM private-key blocks, and `password=`/`api_key=` style assignments.
- Markdown styling details beyond what the spec fixes: frontmatter with `title, agent, session_id, project, created, updated, tags: [ai-chat, <agent>]`, then `## User` / `## Assistant` sections separated by `---`.
