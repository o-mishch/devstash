---
description: Run housekeeping checks or a holistic quality audit over the current changeset.
when_to_use: Use when asked to clean up, run housekeeping, find dead code, remove console.log/TODO leftovers, check env var drift, review code quality, simplify over-engineered code, or audit all uncommitted work before shipping. Modes: check, run, improve.
argument-hint: check|run|improve
disable-model-invocation: true
allowed-tools: Agent, Glob, Grep, Read, Write, Edit, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs, Bash(git *), Bash(rg *), Bash(grep *), Bash(find *), Bash(ls *), Bash(cat *), Bash(head *), Bash(tail *), Bash(wc *), Bash(echo *), Bash(cd *), Bash(npm run *), Bash(npx prisma *), Bash(pgrep *), Bash(pkill *), Bash(rm -rf .next)
---

DevStash cleanup. **Mode:** `$ARGUMENTS`

> **Resolving the mode:** use `$ARGUMENTS` when substituted. If it is empty or arrives unsubstituted (literally `$ARGUMENTS` — e.g. invoked outside Claude Code), infer the mode (`check` / `run` / `improve`) from the user's request; if no mode is given at all, reply with [Usage](#usage) only.

## When to use this skill

Triggered when asked to clean up, run housekeeping, find dead code, remove `console.log`/`TODO` leftovers, check env-var drift, review code quality, simplify over-engineered code, or audit uncommitted work before shipping. Pick a mode by depth: `check` (fast read-only scan) · `run` (scan + fix approved) · `improve` (deep rule-compliance + quality audit). Full comparison in [Usage](#usage).

## How to use it

1. Resolve the mode (above), then read the files for that mode in [Read order](#read-order).
2. Take the [Scope snapshot](#scope-snapshot) so you know which files are in play.
3. Follow the matching section — [Check](#check) · [Run](#run) · [Improve](#improve) — and route via the [Route](#route) table.
4. Honour [Shared rules & patterns](#shared-rules--patterns): no edits/commits without approval; verify before reporting done.

## Scope snapshot

In Claude Code the two lines below inject their command output automatically. If instead you see the raw command text (another agent/IDE that does not expand inline shell injection), run both commands yourself to get the changeset.

- Modified/added: !`git diff --name-only HEAD`
- Untracked: !`git ls-files --others --exclude-standard`

## Route

| `$ARGUMENTS` | Action |
| --- | --- |
| _(empty)_ | Reply **only** with [Usage](#usage) — no scan |
| `check` | [Check](#check) |
| `run` | [Run](#run) |
| `improve` | [Improve](#improve) |

## Usage

| Mode | Behavior | Cost | When to use |
| --- | --- | --- | --- |
| `check` | Fast scan (9 essential checks) · numbered report · no edits | ~2–3 min | Before commit; verify basics |
| `run` | Same as `check` · ask which items to fix · apply approved | ~3–4 min | Before commit; fix basic issues |
| `improve` | Deep audit (7 quality categories) — **research runs in a foreground opus subagent (single turn)**, main agent only relays the audit + fixes approved IDs | ~5–10 min | After review; prepare for ship; refactoring |

## Read order

Read before work. ✓ = always. _scope_ = when matching paths are uncommitted. Paths under `improve/` are **relative to this skill's own directory** (`.agents/skills/cleanup/`) — read them there, not from the project root; `.agents/rules/*` paths are relative to the project root.

**In `improve` the ✓ files are read by the Stage-A research subagent, not the main agent** — that delegation is exactly how the main context stays clean. The main agent reads none of them; it spawns the subagent, then orchestrates approval/fix/verify. The subagent's self-contained prompt lists these paths so it reads them cold. `check`/`run` read their subset directly in the main agent as before.

| File | check | run | improve |
| --- |:---:|:---:|:---:|
| `.agents/rules/*` (all rule files, read in full) | — | — | ✓ |
| `.agents/rules/ai-interaction.md` | ✓ | ✓ | — |
| `.agents/rules/coding-standards.md` | ✓ | ✓ | — |
| `.agents/rules/nextjs-architecture.md` | scope | scope | — |
| `.agents/rules/database.md` | scope | scope | — |
| `.agents/rules/security.md` | scope | scope | — |
| `.agents/rules/api-contract.md` | scope | scope | — |
| `.agents/rules/testing.md` | scope | scope | — |
| `improve/checklist.md` | — | — | ✓ |
| `improve/report.md` | — | — | ✓ |

Improve is a **strict rule-compliance gate**: it reads the whole `.agents/rules/*` glob (so `nextjs-architecture.md`, `database.md`, and any future rule file are auto-covered). Any violation of any rule is a finding whose default fix is refactoring to compliance — see [Improve](#improve). `check`/`run` read only the per-file subset above.

## Shared rules & patterns

**Process:**
- ✅ No revert/delete without explicit approval · no commits unless asked
- ✅ Small, focused fixes; state changes before editing; summarize after
- ✅ Always verify fixes with lint/test/build before reporting done

**Search patterns for `check` mode:**
- Logs: `rg 'console\.(log|warn|error|debug)' src/`
- Comments: `rg '(TODO|FIXME|HACK)' src/` + verify still needed
- TS pragmas: `rg '@ts-(ignore|expect-error)' src/` + verify why

**Search patterns for `improve` mode (optional, on-demand):**
- Duplicate logic: `rg 'function|const.*=.*=>' src/ --type ts --type tsx` (scan for patterns)
- Dead exports: `rg '^export' src/ --type ts --type tsx && cross-reference imports`
- Orphaned files: `rg --files src/ && check if imported anywhere`
- N+1 queries: `rg 'prisma\.(user|item|collection)\.findMany' src/ inside loops` (manual scan)
- Missing tests: `find src/actions src/lib -name '*.ts' ! -name '*.test.ts'`

---

## Check

**Flow:** `scan → numbered report → stop` (~2–3 min, 9 fast checks)

| # | Check | Cost | Method |
| --- | --- | --- | --- |
| 1 | `context/history.md` oldest → newest | O(1) | read & verify chronological |
| 2 | `context/current-feature.md` goals/notes match — **do not** touch `## Status` | O(1) | read & verify alignment |
| 3 | No `console.log` / `console.*` in `src/` | O(n) | `rg 'console\.(log\|warn\|error\|debug)' src/` |
| 4 | Stale `TODO` / `FIXME` / `HACK` comments | O(n) | `rg 'TODO\|FIXME\|HACK' src/` — verify still relevant |
| 5 | Stale `@ts-ignore` / `@ts-expect-error` | O(n) | `rg '@ts-' src/ && verify why in code` |
| 6 | Missing Prisma migration for schema changes | O(1) | `prisma migrate status` must show "Up to date" |
| 7 | `.env._production`, `.env.example`, `.env`, `src/types/env.d.ts` sync | O(1) | diff all; verify all vars present + typed |
| 8 | ESLint + TypeScript compile | O(n) | `npm run lint` (covers unused imports, inline types, pattern violations) |
| 9 | Test coverage for new/changed actions/utils | O(n) | verify `*.test.ts` exists for new `*.ts` in `src/actions/`, `src/lib/` |

**Output:** numbered findings with file refs · severity (Critical, Major, Minor) · remediation hint.

**Cost notes:** ✅ ESLint already enforces: unused imports, unused variables, inline object types, type safety, API contract patterns. Running it once covers checks 4, 8, 9 of the old list + more. Prettier (enforced in ESLint config) handles formatting.

## Run

**Flow:** `scan → report → ask which to fix → apply approved → verify`

Runs all [Check](#check) checks above. After reporting, asks user:
```
Which checks should I fix? Format: "1, 3, 5" or "all" or "none"
```

**Apply fixes** for approved items only. Summary table columns: `#` · `Item` · `Status` · `Notes`.

## Improve

**Goal:** Deep quality audit of uncommitted code · KISS principle (−LOC preferred) · report findings · fix approved items only.

**When to use:** `check` mode passed, user asks for deeper analysis, or significant refactor needed.

**Context discipline — research runs in a subagent.** All codebase research (reading the rules, every changed file, neighbourhood widening, pattern `rg` sweeps, rule-compliance, context7 lookups) runs inside **one foreground subagent on the opus model** (spawned synchronously within this turn — never `run_in_background`). Intermediate file reads and scan output stay in the subagent's context; the main agent's context never fills with them. The subagent returns **only** the finished `Code quality audit` markdown. The main agent then relays that report and handles approval, fixes, and verification — it does not re-read the changeset.

**Posture — be critical (subagent's job).** A clean changeset is the *floor*, not the result. Assume repeated patterns and simplifications exist until you have looked wide enough to rule them out. Analysis is **codebase-wide**; only *edits* stay scoped to the changeset. If the audit reports few or zero findings, it must justify per category *why* it is genuinely clean — never default to "looks good."

**Strict rule compliance is the hard gate (subagent's job).** Read every file under `.agents/rules/*` in full, then check the reviewed code against each rule line by line. A rule is a **must**, not a preference: any deviation is a finding (Major if the rule is phrased as must/never or touches security/architecture/API contract, Minor only for soft style points), and its **default fix is refactoring the code to comply** — not documenting the gap. Compliance findings are reported regardless of user approval; do not pass code that violates a rule just because it "works." Map each finding to the specific rule file + section it breaks (the P1–P5 lenses below already trace to these rules).

**Flow — two stages.** Stage A (subagent): inventory → scan → widen → pattern pass → **rule-compliance pass** → research → categorize → report. Stage B (main agent): relay → approve → fix → verify (~5–10 min).

### Stage A — research subagent (opus, foreground)

The main agent spawns **one** foreground subagent with the Agent tool and receives the finished audit as that call's result, in the same turn — it runs no research itself, and must **not** poll, watch the subagent transcript, arm background watchers, or use `TaskOutput`/`TaskStop`.

- `subagent_type: general-purpose` · `model: opus` · `run_in_background: false` (foreground — blocks this turn until the audit returns)
- **Why foreground, not background:** a fresh user turn interrupts any in-flight background agent, so a background research run gets killed mid-pass and its result is lost — and the main agent then wastes turns babysitting a transcript that never completes. A foreground run finishes inside the spawning turn and cannot be interrupted.
- The prompt must be **self-contained** (subagents start cold — they do not inherit this conversation). It instructs the subagent to:
  1. Read **every** file under `.agents/rules/*` in full, plus `.agents/skills/cleanup/improve/checklist.md` and `.agents/skills/cleanup/improve/report.md`.
  2. Take the scope snapshot — `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` — and stop if empty.
  3. Run phases 1–8 below (INVENTORY → REPORT), codebase-wide.
  4. Honour the feature-doc precedence in `context/current-feature.md` (an in-flight migration supersedes a standing rule for files in its scope).
  5. Prefer the **Grep / Glob / Read tools** (which never prompt for permission) for content and file searches; reserve **Bash** for `git`, `rg`, and `find`, plus read-only inspection (`grep`, `cat`, `head`, `tail`, `wc`, `ls`, `echo`). Avoid `while`/`for` read-loops and `>` temp-file redirects — run the Grep tool over a path glob instead.
  6. **Return only** the rendered `Code quality audit` markdown (per `improve/report.md`) as its final message — no intermediate logs, no file dumps, no preamble.

### Stage B — main agent (orchestration)

When the foreground Agent call returns: **relay** the returned audit verbatim, then drive approval → fix → verify using the finding cards in that audit. The main agent never reads `.agents/rules/*` or `improve/*` — everything it needs is in the returned report.

| # | Phase | Runs in | Action |
| ---: | --- | --- | --- |
| 1 | INVENTORY | subagent | scan `git diff HEAD` + untracked files in `src/` + `prisma/` · stop if empty |
| 2 | SCAN | subagent | read every changed file in full; cross-reference imports/exports/callers for flows |
| 3 | WIDEN | subagent | for each changed file also read its **neighbourhood** — sibling files in the same dir, its callers, and files that do a similar job — so cross-file repetition becomes visible. The diff alone hides duplication |
| 4 | PATTERN PASS | subagent | for every non-trivial shape in the changeset (a guard, conditional, data transform, prop interface, fetch→map, error map) `rg` the codebase for the same shape. **2+ occurrences = repeated pattern** → propose one source of truth, or apply an existing util/hook/pattern already in `src/`. Also flag any hand-rolled logic a library already provides (React, Next.js, Prisma, Zod, TanStack Query/Virtual, Zustand, shadcn/ui) |
| 5 | RULE-COMPLIANCE PASS | subagent | check every reviewed file against **each rule** in `.agents/rules/*` (read all of them in full first). Every deviation from a rule is a finding; default fix = refactor the code to comply. Cite the rule file + section. Treat must/never/security/architecture/API-contract rules as Major |
| 6 | RESEARCH | subagent | when unsure whether a leaner library-idiomatic API exists, **query context7** (`mcp__context7__*`) before concluding the code is optimal. Do not guess library APIs from memory |
| 7 | CATEGORIZE | subagent | identify issues per checklist; assign severity |
| 8 | REPORT | subagent | render the full `Code quality audit` per `improve/report.md` (numbered IDs · severity · file refs · remediation · LOC delta est.) and return it as the final message |
| 9 | APPROVE | main | relay the audit, then ask which IDs to fix; format: `P1-1, P2-3, all major, none` |
| 10 | FIX | main | apply lowest-LOC path for each approved ID using its finding card; prefer −LOC over neutral |
| 11 | VERIFY | main | `npm run lint`, `npm run test:run`, `npm run build` (if touching build config) |

**Lenses** — full definitions, signals, and severity live in `improve/checklist.md` (the single source). Improve scans all five; `check`/`run` skip them. Each lens traces to one or more `.agents/rules/*` files — the rule-compliance pass checks the code against that rule, and a deviation is a finding under that lens.

| Lens | Covers | Rule source | Highest yield |
| --- | --- | --- | --- |
| **P1** Architecture & SOLID | layer placement · `prisma.*` outside `src/lib/db/` · FE/BE leak · redesign that removes structure | `nextjs-architecture.md`, `database.md` | — |
| **P2** KISS & duplication | repeated patterns across 2+ files · existing util / library idiom not applied · over-decompose · −LOC wins | `coding-standards.md` (§ Code Quality) | ⭐ work hardest |
| **P3** Security & access | IDOR (`userId` from input) · missing Zod / auth check · webhook signature · stale cache granting wrong access | `security.md` | — |
| **P4** Bugs, regressions & logging | wrong branch / null edge · floating promise · missing/ noisy `logger.child` logs | `coding-standards.md` (§ Logging) | — |
| **P5** Convention, hygiene & tests | `coding-standards` + `api-contract` (`apiRoute`/`ApiResponse`/api-fetch verb helpers) · `'use client'` overuse · missing `.test.ts` | `coding-standards.md`, `api-contract.md`, `testing.md`, `ai-interaction.md` | — |

**Constraints & discipline:**
- ✅ Prefer −LOC fixes (delete > merge > inline > refactor)
- ✅ No edits until user approves specific IDs
- ✅ All fixes together in single changeset
- ✅ Security, Testing, **and rule-compliance** findings are **always** reported, regardless of user approval; the default fix for a rule violation is refactoring the code to comply
- ✅ **Analysis** is codebase-wide (find repeated patterns wherever they live); **edits** stay scoped to the changeset + the one shared file needed to dedupe
- ✅ When in doubt about a library's idiomatic API, **research via context7** instead of guessing — a missed simplification is a finding, not a pass
- ❌ No unrelated refactors unless they remove a repeated pattern the changeset participates in
- ❌ Cost O(files²) checks (unused exports, orphaned files) only if user explicitly asks
