# convo-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency, cross-platform skill. It saves AI-agent conversations (Claude Code, Codex, Antigravity, OpenCode) as one Markdown note per session inside the project, triggered automatically by each agent's hook.

**Architecture:** `scripts/convo-sync.mjs` is the CLI (`sync`, `install`, `uninstall`, `status`). Each agent adapter turns its transcript into one shared `Session` object. A renderer turns a `Session` into Markdown, and a redactor scrubs secrets. An installer merges hook entries into each agent's config file. OpenCode has no stable transcript file, so a small plugin hands its messages to the CLI on stdin.

**Tech Stack:** Node.js ≥ 22 with built-in modules only (`node:fs`, `node:path`, `node:os`, `node:child_process`, `node:test`, `node:assert`).

**Spec:** `docs/superpowers/specs/2026-11-05-convo-sync-design.md`

## Global Constraints

- Zero npm dependencies. ES modules (`.mjs`). Node ≥ 22.
- `sync` ALWAYS exits 0 and prints exactly `{}` on stdout, whatever the error. Errors are appended to `<os.tmpdir()>/convo-sync.log`.
- Output file name: `YYYY-MM-DD_<agent>_<first 8 chars of sessionId>.md`. The date is the session's first message date in local time. A raw copy is written next to it with the same base name and `.jsonl`.
- Default config: `{ outputDir: ".agents/conversations", redact: true, copyRaw: true, includeThinking: false, includeTools: false }`, overridden by `<projectRoot>/.convo-sync.json`.
- The tool never runs git.
- Installers merge into existing config, never duplicate (they look for the `convo-sync` marker in the command string), and `uninstall` removes only our entries.
- Hook commands quote both paths: `node "<abs path to convo-sync.mjs>" sync --agent <agent>`.
- Test fixtures are synthetic. Never copy real transcripts into the repo.

## Review Focus

1. **Missing or unreadable transcript, or malformed JSONL lines:** `sync` still exits 0 with `{}`, skips bad lines, and writes whatever parsed. Covered in Task 2 and each adapter task.
2. **Install paths with spaces** (`C:\Users\First Last\...`): the hook command quotes the paths. Covered in Task 6.
3. **Existing user hooks in settings files:** they are kept; running install twice leaves exactly one entry. Covered in Task 6.
4. **Secrets inside code blocks and pasted logs:** redacted before writing, in both the `.md` and the raw `.jsonl` copy. Covered in Tasks 1 and 5.
5. **CRLF line endings and UTF-8 BOM** in JSONL and in settings JSON: parsed correctly. Covered in Tasks 2 and 6.

---

## File structure

```
convo-sync/
├── SKILL.md                         # skill instructions (Task 8)
├── README.md, LICENSE               # Task 8
├── package.json                     # {"type":"module","engines":{"node":">=22"},"scripts":{"test":"node --test test/"}}
├── scripts/
│   ├── convo-sync.mjs               # CLI entry + arg parsing (Task 5)
│   ├── opencode-plugin.js           # plugin template copied by installer (Task 7)
│   └── lib/
│       ├── session.mjs              # Session typedef + jsonl reader (Task 1)
│       ├── redact.mjs               # Task 1
│       ├── render.mjs               # Task 1
│       ├── config.mjs               # Task 1
│       ├── adapters/claude.mjs      # Task 2
│       ├── adapters/codex.mjs       # Task 3
│       ├── adapters/antigravity.mjs # Task 4
│       ├── adapters/opencode.mjs    # Task 7
│       ├── sync.mjs                 # Task 5
│       └── install.mjs              # Task 6 (+ opencode in Task 7)
└── test/
    ├── fixtures/                    # synthetic transcripts
    └── *.test.mjs
```

---

### Task 1: Core: session model, redaction, rendering, config

**Files:** Create `package.json`, `.gitignore` (`node_modules/`), `scripts/lib/session.mjs`, `scripts/lib/redact.mjs`, `scripts/lib/render.mjs`, `scripts/lib/config.mjs`. Tests: `test/redact.test.mjs`, `test/render.test.mjs`, `test/config.test.mjs`.

**Interfaces (produced):**
- `Session = { agent: 'claude'|'codex'|'antigravity'|'opencode', sessionId: string, cwd: string|null, startedAt: Date|null, updatedAt: Date|null, messages: Message[] }`
- `Message = { role: 'user'|'assistant', text: string, thinking?: string, tools?: string[], at?: Date }`
- `readJsonl(text: string): object[]`: strips the BOM, splits on `/\r?\n/`, skips blank and unparsable lines.
- `redact(text: string): string`
- `fileBaseName(session: Session): string`: e.g. `2026-11-05_claude_6ca14529`
- `toMarkdown(session: Session, opts: {includeThinking: boolean, includeTools: boolean}): string`
- `loadConfig(projectRoot: string): Config` (defaults merged with `.convo-sync.json`; an invalid JSON file falls back to the defaults)

- [ ] **Step 1: Write failing tests**
  - `readJsonl('\uFEFF{"a":1}\r\nnot json\r\n\r\n{"b":2}')` deep-equals `[{a:1},{b:2}]`.
  - `redact` replaces each of these with `[REDACTED]` and leaves surrounding text intact: `sk-ant-api03-abcDEF1234567890abcdef`, `sk-proj-abcdefghijklmnopqrstuv`, `ghp_` + 36 alphanumerics, `AKIAIOSFODNN7EXAMPLE`, `Authorization: Bearer eyJhbGciOi.abc.def`, a `-----BEGIN RSA PRIVATE KEY-----…-----END RSA PRIVATE KEY-----` block, `api_key = "abc123secret"` → `api_key = "[REDACTED]"`, `PASSWORD=hunter2` → `PASSWORD=[REDACTED]`. `redact('the word skeleton')` is unchanged.
  - `fileBaseName({agent:'claude', sessionId:'6ca14529-41a8', startedAt:new Date(2026,10,5,10)})` === `'2026-11-05_claude_6ca14529'`. A null `startedAt` uses today's date.
  - `toMarkdown` output starts with `---\n`, contains `agent: claude`, `session_id: 6ca14529-41a8`, `tags:\n  - ai-chat\n  - claude`, then `## User\n\nhi` and `## Assistant\n\nhello`. With `includeThinking:false`, the thinking text is absent. With `includeThinking:true`, it appears inside a `> [!note]- Thinking` callout. With `includeTools:true`, a line `*Tools: Read, Edit*` appears under the assistant text.
  - The frontmatter title is the first user message, trimmed to 80 chars, with newlines collapsed and `"` escaped, wrapped in double quotes.
  - `loadConfig(tmpDirWithout)` deep-equals the defaults. With `{"outputDir":"notes/ai","redact":false}` the merge works. With `{bad json`, it returns the defaults.

- [ ] **Step 2:** `node --test test/` → FAIL (modules missing).
- [ ] **Step 3:** Implement the four modules to the interfaces above. Redaction is a list of `[RegExp, replacer]` pairs applied in order.
- [ ] **Step 4:** `node --test test/` → all pass.
- [ ] **Step 5:** `git add -A && git commit -m "feat: core session model, redaction, markdown rendering, config"`

---

### Task 2: Claude Code adapter

**Files:** Create `scripts/lib/adapters/claude.mjs`, `test/fixtures/claude.jsonl`, `test/claude.test.mjs`.

**Interfaces:**
- Consumes: `readJsonl`, `Session`.
- Produces: `parseClaude(text: string, meta: {sessionId?: string, cwd?: string}): Session` and `locateClaude(payload): {transcriptPath: string|null, sessionId: string|null, cwd: string|null}`. The payload fields are `transcript_path`, `session_id` and `cwd`.

Parsing rules:
- Only lines with `type` of `user` or `assistant`. Skip lines with `isSidechain: true` or `isMeta: true`.
- `message.content` is either a string or an array of blocks. Take `text` blocks as text, `thinking` blocks as thinking, and `tool_use` blocks' `name` into tools. Ignore `tool_result` blocks.
- Drop user text that is empty after trimming, or that starts with `<command-`, `<local-command-`, `<system-reminder>` or `<task-notification>`.
- Merge consecutive assistant lines into a single `Message`, because Claude writes one line per content block.
- `sessionId` comes from the line's `sessionId`, then `meta`. `cwd` comes from the first line that has one. `startedAt` and `updatedAt` are the first and last `timestamp`.

- [ ] **Step 1: Write the fixture and failing test.** The fixture contains: `queue-operation`, a user line with string content `"hi"`, two assistant lines (`[{type:'thinking',thinking:'hmm'}]`, then `[{type:'text',text:'hello'},{type:'tool_use',name:'Read'}]`), a user line with only a `tool_result`, an assistant line `text:'done'`, a user line `<system-reminder>x</system-reminder>`, a sidechain assistant line, and one garbage line. Assertions:
  - The messages are `[user 'hi', assistant 'hello\n\ndone' with thinking 'hmm' and tools ['Read']]`. The 'done' line follows a tool_result-only user line that is dropped, so it merges into the previous assistant message.
  - `sessionId` and `startedAt` are correct.
  - `locateClaude({transcript_path:'/x.jsonl', session_id:'s', cwd:'/p'})` maps all three fields.
- [ ] **Step 2:** Run `node --test test/claude.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: claude code adapter`.

---

### Task 3: Codex adapter

**Files:** `scripts/lib/adapters/codex.mjs`, `test/fixtures/codex.jsonl`, `test/codex.test.mjs`.

**Produces:**
- `parseCodex(text: string, meta): Session`
- `locateCodex(payload): {transcriptPath, sessionId, cwd}`
- `findCodexRollout(sessionId: string, home = process.env.CODEX_HOME || ~/.codex): string|null`. This is the fallback when `transcript_path` is null. It searches `sessions/*/*/*/` for a file name ending `-<sessionId>.jsonl`, checking the newest day folders first.

Parsing rules:
- `session_meta.payload` gives `id`, `cwd` and `timestamp`.
- Take `response_item` lines whose `payload.type === 'message'` and whose `role` is `user` or `assistant` (skip `developer` and `system`).
- The text is the `content[].text` values of type `input_text` or `output_text`, joined with `\n\n`.
- Drop user text starting with `<environment_context>`, `<user_instructions>`, `<permissions` or `# AGENTS.md`.
- `response_item` with `payload.type === 'function_call'` or `'custom_tool_call'` contributes `payload.name` to the current assistant message's tools.
- `payload.type === 'reasoning'` contributes `summary[].text` as thinking.
- Merge consecutive assistant messages.

- [ ] **Step 1:** Write the fixture and failing test, covering `session_meta`, an environment_context user message (dropped), a real user message, a function_call `exec`, an assistant `output_text`, and a garbage line. Assert the messages, `sessionId` and `cwd`. Add a test that `findCodexRollout('abc', tmpHome)` finds `tmpHome/sessions/2026/10/26/rollout-2026-10-26T11-31-23-abc.jsonl` and returns null when it's missing.
- [ ] **Step 2–4:** Watch it fail, implement, watch it pass.
- [ ] **Step 5:** Commit: `feat: codex adapter`.

---

### Task 4: Antigravity adapter

**Files:** `scripts/lib/adapters/antigravity.mjs`, `test/fixtures/antigravity.jsonl`, `test/antigravity.test.mjs`.

**Produces:**
- `parseAntigravity(text, meta): Session`
- `locateAntigravity(payload): {transcriptPath, sessionId, cwd}`. It reads `transcriptPath` and `conversationId`, and takes `cwd` from `workspacePaths[0]`. When `conversationId` is missing it falls back to the `brain[\\/]([0-9a-f-]{36})` match in the path.

Parsing rules (taken from the working PS1 prototype):
- `source === 'USER_EXPLICIT'` with string `content`: user text is the inner text of `<USER_REQUEST>…</USER_REQUEST>` when present, otherwise the whole content, trimmed.
- `source === 'MODEL' && type === 'PLANNER_RESPONSE'`: assistant text is `content` when it is a string. `thinking` goes to thinking when it is a string. `tool_calls[].name` (if it's an array) goes to tools. Drop the entry when there is no text, thinking or tools.
- Skip `GENERIC` and other types.
- Merge consecutive assistant messages.
- `created_at` gives the timestamps.

- [ ] **Step 1:** Write the fixture and failing test. Cover a USER_INPUT with `<USER_REQUEST> hi </USER_REQUEST><ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>`, a PLANNER_RESPONSE with only `tool_calls:[{name:'view_file'}]`, a PLANNER_RESPONSE with `content:'hello'`, and a GENERIC line. Expect `[user 'hi', assistant 'hello' tools ['view_file']]`.
- [ ] **Step 2–4:** Watch it fail, implement, watch it pass.
- [ ] **Step 5:** Commit: `feat: antigravity adapter`.

---

### Task 5: `sync` command and CLI entry

**Files:** `scripts/lib/sync.mjs`, `scripts/convo-sync.mjs`, `test/sync.test.mjs`.

**Interfaces:**
- Consumes: all adapters (`parse*` and `locate*`), `loadConfig`, `redact`, `toMarkdown`, `fileBaseName`.
- Produces:
  - `syncSession({agent, payload, projectRoot?}): Promise<{mdPath: string|null}>`
  - `projectRootFor(cwd: string): string`: walks up from `cwd` to the first directory containing `.git`; if there is none, it returns `cwd`.
  - CLI: `node scripts/convo-sync.mjs sync --agent <a> [--payload-file <f>]`. It reads the payload JSON from stdin, or for OpenCode from the `--payload-file`.

Behaviour:
- The output directory is `path.resolve(projectRoot, config.outputDir)`, created recursively.
- Redact each message's text and thinking when `config.redact` is set.
- Write the `.md` atomically: write `<name>.md.tmp`, then rename.
- When `copyRaw` is set and a transcript path exists, write the redacted raw text to `<name>.jsonl`.
- Skip writing when the session has 0 messages.
- The CLI wraps everything in try/catch, appends errors to the log, prints `{}`, and calls `process.exit(0)`.
- The stdin read times out after 2 s, so a missing payload can't hang the hook.

- [ ] **Step 1:** Write failing tests. Use temp dirs only: copy the claude fixture into `tmp/transcript.jsonl` and create `tmp/proj/.git/`.
  - `syncSession({agent:'claude', payload:{transcript_path, session_id:'6ca14529-xx', cwd: tmp/proj/sub}})` writes `tmp/proj/.agents/conversations/<date>_claude_6ca14529.md` and `.jsonl`.
  - Running it twice leaves 1 `.md` file.
  - With `.convo-sync.json` `{"outputDir":"notes","copyRaw":false}`, the file is written under `notes/` and there's no `.jsonl`.
  - A fixture containing `sk-ant-api03-abcDEF1234567890abcdef` yields neither file containing that string.
  - A nonexistent `transcript_path` makes `syncSession` resolve `{mdPath:null}` without throwing.
  - CLI test: `spawnSync(process.execPath, [cli, 'sync', '--agent', 'claude'], {input: 'garbage'})` has status 0 and stdout `{}\n`.
- [ ] **Step 2–4:** Watch it fail, implement, watch it pass.
- [ ] **Step 5:** Commit: `feat: sync command and CLI`.

---

### Task 6: Installer for Claude Code, Codex and Antigravity

**Files:** `scripts/lib/install.mjs`, and modify `scripts/convo-sync.mjs` (`install`, `uninstall` and `status` subcommands). Tests: `test/install.test.mjs`.

**Produces:**
- `install({agent, scope, projectRoot, home, scriptPath}): {file: string, changed: boolean, note?: string}`
- `uninstall(sameArgs)`
- `status({projectRoot, home}): Array<{agent, scope, file, installed}>`
- CLI: `install --agent <claude|codex|antigravity|opencode|all> --scope <project|user>`. The default scope is `project`, and `scriptPath` is resolved from `import.meta.url`.

| agent | project file | user file | entry written |
|---|---|---|---|
| claude | `.claude/settings.json` | `~/.claude/settings.json` | `hooks.Stop[] += {hooks:[{type:'command', command, timeout:30}]}` |
| codex | `.codex/hooks.json` | `~/.codex/hooks.json` | `hooks.Stop[] += {hooks:[{type:'command', command, timeout:30}]}`. The `note` tells the user to set `[features] hooks = true` in `~/.codex/config.toml` when that file lacks the line. Never edit the TOML. |
| antigravity | `.agents/hooks.json` | `~/.gemini/config/hooks.json` | top-level key `"convo-sync": {enabled:true, PostInvocation:[{type:'command', command, timeout:15}]}` |

`command` is `node "<scriptPath>" sync --agent <agent>`.

- Read existing files tolerating a BOM. If an existing file is invalid JSON, abort that agent with a `note` and leave the file untouched.
- Write the file with 2-space indent and a trailing newline.
- Before the first modification of an existing file, back it up to `<file>.convo-sync.bak`.

- [ ] **Step 1:** Write failing tests in a temp project/home.
  - A fresh install creates each file with exactly the entry above.
  - An existing `.claude/settings.json` with `permissions` and another `Stop` hook keeps both after install.
  - Running install twice gives exactly one convo-sync entry.
  - Uninstall removes only ours and keeps the other Stop hook.
  - A `scriptPath` containing a space (`/tmp/a b/convo-sync.mjs`) appears quoted in the command.
  - A settings file starting with a BOM is merged correctly.
  - Invalid JSON returns `changed:false` with a note, and the file bytes are unchanged.
  - `status` reports installed true or false per agent.
- [ ] **Step 2–4:** Watch it fail, implement, watch it pass.
- [ ] **Step 5:** Commit: `feat: hook installer for claude, codex, antigravity`.

---

### Task 7: OpenCode plugin, adapter and installer

**Files:** `scripts/opencode-plugin.js`, `scripts/lib/adapters/opencode.mjs`, and modify `scripts/lib/install.mjs` and `scripts/lib/sync.mjs`. Test: `test/opencode.test.mjs`.

- [ ] **Step 0: Verify against the OpenCode SDK/docs before coding.** Check the `session.idle` event's property name for the session id (expected `event.properties.sessionID`) and the shape returned by `client.session.messages({ path: { id } })` (expected `Array<{info: {role, time:{created}}, parts: Array<{type, text?, tool?}>}>`, possibly wrapped in `{data}`). Record what you find at the top of the plugin file. If either differs, adapt the payload shape below and keep the adapter contract.
- **Plugin** (`.js`, exports `ConvoSync`): on `session.idle`, it fetches the messages and writes `{sessionId, cwd: directory, messages}` to a temp JSON file under `os.tmpdir()`. It then spawns `node "<SCRIPT_PATH>" sync --agent opencode --payload-file <tmp>` with `stdio:'ignore'`, detached, and swallows errors. The installer replaces the `__CONVO_SYNC_SCRIPT__` placeholder with the JSON-escaped absolute script path.
- **Produces:** `parseOpenCode(payload: {sessionId, cwd, messages}): Session`.
  - Text parts become text. `reasoning` parts become thinking. `tool` parts become their `tool` name in tools.
  - Unwrap `{data:[…]}` if present.
  - `sync` deletes the payload file after reading it. There is no raw `.jsonl` for OpenCode.
- **Installer:** the project file is `.opencode/plugins/convo-sync.js` and the user file is `~/.config/opencode/plugins/convo-sync.js`. It writes the rendered template; uninstall deletes the file only if it contains the `convo-sync` marker.

- [ ] **Step 1:** Write failing tests.
  - `parseOpenCode` on a synthetic payload (user text 'hi'; assistant with reasoning 'hmm', tool 'bash', text 'hello'; also the `{data:[…]}`-wrapped variant) gives `[user 'hi', assistant 'hello' thinking 'hmm' tools ['bash']]`.
  - The installer writes a plugin file containing the quoted script path and no placeholder.
  - `sync --agent opencode --payload-file f` writes the `.md` and deletes `f`.
- [ ] **Step 2–4:** Watch it fail, implement, watch it pass.
- [ ] **Step 5:** Commit: `feat: opencode plugin and adapter`.

---

### Task 8: SKILL.md, README, LICENSE and real-world verification

**Files:** `SKILL.md`, `README.md`, `LICENSE` (MIT, holder to be confirmed with the user).

- **`SKILL.md` frontmatter:** `name: convo-sync` and a `description` (≤ 1024 chars) saying when to use it: the user wants AI conversations saved, synced or exported to Markdown/Obsidian, or asks to install, check or disable conversation sync.
- **`SKILL.md` body:**
  1. Install for the current agent: `node "<skill dir>/scripts/convo-sync.mjs" install --agent <current agent> --scope project`. Tell the agent to identify itself and to resolve `<skill dir>` as the directory of this SKILL.md.
  2. Relay the installer's `note` lines to the user, e.g. the Codex feature flag.
  3. Run `status`.
  4. Run a manual sync with `sync --agent <a>` by passing a payload.
  5. Config keys.
  6. A privacy warning: transcripts may contain secrets, redaction is best-effort, and the user should review notes before pushing.
- **`README.md`:** what it does, `npx skills add <owner>/convo-sync`, a per-agent table (trigger and file), config, privacy, a limitations section ("transcript formats are unofficial and may change"), and uninstall.

- [ ] **Step 1:** Write the three files.
- [ ] **Step 2:** Run `node --test test/`. Expected: all pass.
- [ ] **Step 3: Real-transcript check (no writes into other projects).** Run `sync` for each agent with a payload that points at the newest real transcript on this machine and a `cwd` set to a temp dir containing `.git`. Open the resulting `.md` files and confirm the user and assistant turns read correctly and that no harness noise (environment_context, system-reminder) leaks through. Fix the adapters if it does and add a regression fixture line.
- [ ] **Step 4: Live hook check (with the user's permission).** Install the Claude project scope into a scratch project, run one Claude Code turn there, and confirm the note appears.
- [ ] **Step 5:** Run `npx skills add ./` locally into a temp project (or `--copy`) to confirm `scripts/` is installed with the skill.
- [ ] **Step 6:** Commit: `docs: skill instructions and readme`.

Publishing (creating the GitHub repo and pushing it) is a separate, user-approved step after this plan.
