# Note summary block — design

Date: 2026-11-06. Status: approved in chat.

## Why

Switching agents or models costs tokens: the next agent needs the earlier work, and every tool call re-sends everything it has read. A measured Cursor restore cost 97k input tokens; convo-sync's own output was ~6% of it, but the 12k-char digest still drops the middle of long sessions. The user wants both: the full conversation kept as is, plus a short summary that gives the next agent an instant picture at near-zero cost, with the full note there for going deep.

## Goals

- Each note starts with a summary block, rebuilt on every sync, at no model cost.
- `context` prints summaries by default (far fewer tokens than the current digest), with file paths for going deeper.
- Decisions from the middle of long sessions survive via the agent's own compaction summary.

## Non-goals (this round)

- Agent-written handoff (needs per-harness stop-hook verification first).
- Codex compaction summaries (no local sample to build against yet).
- Capturing Cursor chats.

## Anti-goals

- Spending model tokens on every turn to keep a summary current.
- A summary that goes stale relative to its note.
- A hook that can slow down or break the agent (git failures must be silent and bounded).

## Approaches

- **A. Summary block at the top of each existing note — picked.** One file per conversation, rebuilt with the note, so it can never drift; Obsidian shows it first.
- B. Separate `.agents/context/<same-name>.md`. Same content, but two files to keep in step and clean up; only wins if summaries must live elsewhere.

## Design

Summary block, placed after the frontmatter and before the first message:

- **Goal:** first user request (clipped).
- **Status:** latest assistant answer, kept whole up to a cap.
- **Commits since the session started** and **uncommitted files**, from git, max 20 each. Skipped when the project is not a git repo or git fails/times out. Note files under `outputDir` are excluded.
- **Earlier context:** the latest compaction summary, capped at ~4,000 chars.
  - Claude Code: user lines with `isCompactSummary: true`. These are removed from the transcript messages (today they are wrongly rendered as `## User`).
  - Copilot: `session.compaction_complete` events, `data.summaryContent`.
- Everything in the block passes through the existing redaction.

`context`:

- Default: for the newest notes, the header line, file path and summary block. Notes written before this change (no block) fall back to today's digest.
- `--full`: today's digest (first request + latest messages).
- `--limit` / `--max-chars` keep working; the budget split stays as today.

SKILL.md and README describe the new default and `--full`.

## Known limits

- Two agents working in the same repo at once see each other's git changes in their summaries.
- Commit subjects and file paths now appear in notes (redacted like the rest).

## Left to the builder

Exact caps, block wording, and git command flags.
