# Note Summary Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every saved note starts with a model-free summary block, and `context` prints those summaries by default.

**Architecture:** Adapters extract the agent's latest compaction summary into `session.compactSummary`. `sync.mjs` adds git facts (`session.git`). `render.mjs` writes a `## Summary` block before the first message; `context.mjs` parses it back and prints it, keeping today's digest behind `--full`.

**Tech Stack:** Node.js 22+, no dependencies, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-06-note-summary-design.md`

## Global Constraints

- No dependencies; Node 22+.
- Hooks always exit 0 and never hang: every git call is bounded (timeout 3000 ms) and failures are swallowed.
- Everything written to a note passes through `redact()` when `config.redact` is true.
- Caps: goal 500 chars, status 1,500 chars, compaction summary 4,000 chars, 20 commits, 20 files.

## Review Focus

- Project is not a git repo, or git is missing → note still written, no git lines.
- Compaction summary contains a secret → redacted in the note.
- Note written before this change (no `## Summary`) → `context` falls back to the digest for that note.
- Message text that itself contains `## Summary` → not mistaken for the block (block only recognised directly after frontmatter).
- Changed files inside `outputDir` (the notes themselves) → excluded from the uncommitted list.

---

### Task 1: Compaction summaries in adapters

**Files:** Modify `scripts/lib/session.mjs` (typedef), `scripts/lib/adapters/claude.mjs`, `scripts/lib/adapters/copilot.mjs`. Test: `test/claude.test.mjs`, `test/copilot.test.mjs`.

**Interfaces:** Produces `Session.compactSummary?: string` (latest summary text, trimmed; absent when none).

- [ ] Test `parseClaude keeps the compaction summary out of the messages`: a user line with `isCompactSummary: true` and text `"Summary of earlier work"` → `session.compactSummary === 'Summary of earlier work'`, and no message contains that text. With two such lines, the later one wins.
- [ ] Test `parseCopilot reads summaryContent from compaction events`: `{type:'session.compaction_complete', data:{success:true, summaryContent:'<overview>x</overview>'}}` → `compactSummary === '<overview>x</overview>'`.
- [ ] Run `node --test test/claude.test.mjs test/copilot.test.mjs` → both fail.
- [ ] Implement: Claude checks `line.isCompactSummary` before the `isMeta` skip and stores the joined text blocks; Copilot handles `session.compaction_complete` with a string `summaryContent`.
- [ ] Run the same command → pass.

### Task 2: Git facts

**Files:** Create `scripts/lib/git.mjs`. Test: `test/git.test.mjs`.

**Interfaces:** Produces `gitFacts(root: string, since: Date|null, excludeDir: string) -> {commits: string[], files: string[]} | null`. `commits` are `"<short-hash> <subject>"`, newest first; `files` are `git status --porcelain` lines (`" M path"`). `null` when `root` has no `.git` or git fails.

- [ ] Tests (temp repo via `git init`, user.name/email set locally):
  - `gitFacts returns null outside a git repo`
  - `gitFacts lists commits since the given time and uncommitted files` (commit "first", modify a file, add an untracked one → commits contains `first`, files contains both paths)
  - `gitFacts excludes files under excludeDir` (untracked `.agents/conversations/x.md` not listed)
  - `gitFacts caps lists at 20`
- [ ] Run `node --test test/git.test.mjs` → fail.
- [ ] Implement with `execFileSync('git', [...], {cwd: root, timeout: 3000, stdio: ['ignore','pipe','ignore']})`: `log --since=<iso> --format=%h %s -n 20` (omit `--since` when `since` is null) and `status --porcelain -uall`. Filter by path prefix of `excludeDir` relative to `root` (forward slashes). Wrap everything in try/catch → `null`.
- [ ] Run → pass.

### Task 3: Summary block in the note

**Files:** Modify `scripts/lib/render.mjs`, `scripts/lib/sync.mjs`. Test: `test/render.test.mjs`, `test/sync.test.mjs`.

**Interfaces:** Consumes `session.compactSummary`, `gitFacts`. Produces `Session.git?: {commits, files}`; note layout: frontmatter, then

```
## Summary

**Goal:** <first user text, ≤500>

**Status:** <last assistant text, ≤1500>

**Commits since start:**
- <commit>

**Uncommitted files:**
- <status line>

**Earlier context (compacted by the agent):**

<compact summary, ≤4000>

---

```

then the messages as today. Empty sections are omitted; the block is omitted when there is no message.

- [ ] Test `toMarkdown writes a summary block before the first message` (goal, status, commits, files, earlier context all present, `## Summary` appears before `## User`).
- [ ] Test `toMarkdown omits empty summary sections` (no git, no compactSummary → no `Commits`/`Uncommitted`/`Earlier context` lines).
- [ ] Test `syncSession redacts the compaction summary` (compactSummary containing `sk-ant-...` style key from existing redact tests → not in the note).
- [ ] Run the tests → fail.
- [ ] Implement: `render.mjs` builds the block with the caps (reuse a `clip`); `sync.mjs` redacts `compactSummary` and commit lines, then sets `session.git = gitFacts(root, session.startedAt, outDir)` before rendering.
- [ ] Run `node --test` → all pass.

### Task 4: `context` prints summaries by default

**Files:** Modify `scripts/lib/context.mjs`, `scripts/convo-sync.mjs`. Test: `test/context.test.mjs`, `test/cli.test.mjs` if CLI flags are covered there.

**Interfaces:** `parseNote()` also returns `summary: string` (block body without the heading; `''` when absent). `buildContext({projectRoot, limit, maxChars, full = false})`. CLI: `context [--limit n] [--max-chars n] [--full]`.

- [ ] Test `parseNote reads the summary block and keeps messages intact`.
- [ ] Test `buildContext prints the summary block by default and not the messages` (note with 10 messages → output has `**Goal:**`, has the `File:` path, lacks `question 4 `).
- [ ] Test `buildContext --full prints the digest` (`full: true` → old behaviour, `earlier messages omitted` / message text present).
- [ ] Test `buildContext falls back to the digest for notes without a summary` (hand-written note without block).
- [ ] Run → fail.
- [ ] Implement: summary mode renders `## i. agent · date · title`, `File: <path>`, then the summary clipped to the note's share; digest mode is today's `renderNote`. Recognise the block only when the body starts with `## Summary`. Wire `--full` in the CLI and usage text.
- [ ] Run `node --test` → all pass.

### Task 5: Docs and live check

**Files:** `SKILL.md`, `README.md`.

- [ ] SKILL.md Load context: `context` prints each conversation's summary; use `--full` or open the `File:` path for detail. Keep the "answer from the output alone" rule.
- [ ] README: describe the summary block, the `--full` flag, and the shared-repo git caveat.
- [ ] Run `node --test` → all pass.
- [ ] Re-sync a real Claude session with a compaction summary into a scratch folder and run `context` on it; confirm the block and the size of the output.
