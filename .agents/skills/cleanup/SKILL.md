---
name: cleanup
description: Run housekeeping checks or a holistic quality audit over the current changeset.
when_to_use: Use when asked to clean up, run housekeeping, find dead code, remove console.log/TODO leftovers, check env var drift, review code quality, simplify over-engineered code, or audit all uncommitted work before shipping. Modes: check, run, improve.
argument-hint: check|run|improve
allowed-tools: Bash, Glob, Grep, Read, Write, Edit
---

DevStash cleanup. **Mode:** `$ARGUMENTS`

## Scope snapshot

- Modified/added: !`git diff --name-only HEAD 2>/dev/null || echo "none"`
- Untracked: !`git ls-files --others --exclude-standard 2>/dev/null || echo "none"`

## Route

| `$ARGUMENTS` | Action |
| --- | --- |
| _(empty)_ | Reply **only** with [Usage](#usage) — no scan |
| `check` | [Check](#check) |
| `run` | [Run](#run) |
| `improve` | [Improve](#improve) |

## Usage

| Mode | Behavior |
| --- | --- |
| `check` | Housekeeping scan · numbered report · no edits |
| `run` | Same as `check` · ask which items to fix |
| `improve` | Quality audit of all uncommitted files · report · fix approved IDs only |

## Read order

Read before work. ✓ = always. _scope_ = when matching paths are uncommitted.

| File | check | run | improve |
| --- |:---:|:---:|:---:|
| `.agents/rules/ai-interaction.md` | ✓ | ✓ | ✓ |
| `.agents/rules/coding-standards.md` | ✓ | ✓ | ✓ |
| `.agents/rules/security.md` | scope | scope | scope |
| `.agents/rules/api-contract.md` | scope | scope | scope |
| `.agents/rules/testing.md` | scope | scope | scope |
| `improve/checklist.md` | — | — | ✓ |
| `improve/audit-log.md` | — | — | ✓ |
| `improve/report.md` | — | — | ✓ |

## Shared rules

- No revert/delete without explicit approval · no commits unless asked
- Small local fixes; state changes before editing; summarize after
- Search with `rg` / `rg --files`

---

## Check

**Flow:** `scan → numbered report → stop`

| # | Check |
| --- | --- |
| 1 | `context/history.md` oldest → newest |
| 2 | `context/current-feature.md` goals/notes match — do **not** touch `## Status` |
| 3 | No `console.log` in `src/` |
| 4 | Dead code: unused imports/exports, orphaned files |
| 5 | Stale `TODO` / `FIXME` |
| 6 | Stale `@ts-ignore` / `@ts-expect-error` |
| 7 | `.env._production`, `.env.example`, `.env`, `src/types/env.d.ts` agree |
| 8 | ESLint passes or failures reported |

**Output:** numbered findings with file refs.

## Run

**Flow:** `scan → report → ask # to fix → apply approved → summary table`

Same [checks](#check) as `check`. Summary columns: `#` · `Item` · `Status` · `Notes`.

## Improve

**Goal:** One uncommitted solution · **KISS** (decrease `src/` LOC) · report first · fix approved IDs only.

Ignore `context/current-feature.md` unless it is uncommitted and relevant. Details: `improve/*.md` — do not duplicate here.

| Step | Action | See |
| ---: | --- | --- |
| 0 | AUDIT-IN: read `context/cleanup-audit.md`; queue every audit ID (all 4 tables) | `improve/audit-log.md` |
| 1 | INVENTORY: tracked diff + untracked; ask if empty | scope rules |
| 2 | MAP: read every scoped file; trace flows | scope rules |
| 3 | DELTA: audit notebook + `git diff --shortstat HEAD -- src/` | audit-log |
| 4 | EVALUATE: P1→P5 fresh | `improve/checklist.md` |
| 5 | RECONCILE: challenge every audit ID in code (open · implemented · accepted · watchlist) | mandatory reconcile |
| 6 | REPORT: user-facing output; **Audit reconcile** 100% complete → **STOP** | `improve/report.md` |
| 7 | AUDIT-OUT: update `context/cleanup-audit.md` | audit-log |
| 8 | FIX: after user approves IDs; lowest-LOC path | fix discipline |

Pre-approval edits: step 7 only (`context/cleanup-audit.md`). No source fixes until user picks IDs.

**After report:** *"Which IDs should I fix? (e.g. P3-5, all minor, none)"*
