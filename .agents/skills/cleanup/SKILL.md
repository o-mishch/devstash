---
name: cleanup
description: Run housekeeping checks or a holistic quality audit over the current changeset.
when_to_use: Use when asked to clean up, run housekeeping, find dead code, remove console.log/TODO leftovers, check env var drift, review code quality, simplify over-engineered code, or audit all uncommitted work before shipping. Modes: check, run, improve.
argument-hint: check|run|improve
allowed-tools: Bash, Glob, Grep, Read, Write, Edit
---

DevStash cleanup. **Mode:** `$ARGUMENTS`

## Scope snapshot

```bash
git diff --name-only HEAD 2>/dev/null || echo "none"  # modified/added
git ls-files --others --exclude-standard 2>/dev/null || echo "none"  # untracked
```

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
| `improve` | Deep audit (7 quality categories) · report · fix approved IDs only | ~5–10 min | After review; prepare for ship; refactoring |

## Read order

Read before work. ✓ = always. _scope_ = when matching paths are uncommitted.

| File | check | run | improve |
| --- |:---:|:---:|:---:|
| `.agents/rules/ai-interaction.md` | ✓ | ✓ | ✓ |
| `.agents/rules/coding-standards.md` | ✓ | ✓ | ✓ |
| `.agents/rules/security.md` | scope | scope | ✓ |
| `.agents/rules/api-contract.md` | scope | scope | ✓ |
| `.agents/rules/testing.md` | scope | scope | ✓ |
| `improve/checklist.md` | — | — | ✓ |
| `improve/report.md` | — | — | ✓ |

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

**Posture — be critical.** A clean changeset is the *floor*, not the result. Assume repeated patterns and simplifications exist until you have looked wide enough to rule them out. Analysis is **codebase-wide**; only *edits* stay scoped to the changeset. If you end up reporting few or zero findings, justify per category *why* it is genuinely clean — do not default to "looks good."

**Flow:** inventory → scan → widen → pattern pass → research → categorize → report → approve → fix → verify (~5–10 min)

| # | Phase | Action |
| ---: | --- | --- |
| 1 | INVENTORY | scan `git diff HEAD` + untracked files in `src/` + `prisma/` · stop if empty |
| 2 | SCAN | read every changed file in full; cross-reference imports/exports/callers for flows |
| 3 | WIDEN | for each changed file also read its **neighbourhood** — sibling files in the same dir, its callers, and files that do a similar job — so cross-file repetition becomes visible. The diff alone hides duplication |
| 4 | PATTERN PASS | for every non-trivial shape in the changeset (a guard, conditional, data transform, prop interface, fetch→map, error map) `rg` the codebase for the same shape. **2+ occurrences = repeated pattern** → propose one source of truth, or apply an existing util/hook/pattern already in `src/`. Also flag any hand-rolled logic a library already provides (React, Next.js, Prisma, Zod, TanStack Query/Virtual, Zustand, shadcn/ui) |
| 5 | RESEARCH | when unsure whether a leaner library-idiomatic API exists, **query context7** (`context7-mcp` skill → `mcp__context7__*`) before concluding the code is optimal. Do not guess library APIs from memory |
| 6 | CATEGORIZE | identify issues per checklist below; assign severity |
| 7 | REPORT | numbered IDs with severity · file refs · remediation · LOC delta est. |
| 8 | APPROVE | ask which IDs to fix; format: `P1-1, P2-3, all major, none` |
| 9 | FIX | apply lowest-LOC path for each approved ID; prefer −LOC over neutral |
| 10 | VERIFY | `npm run lint`, `npm run test:run`, `npm run build` (if touching build config) |

**Lenses** — full definitions, signals, and severity live in `improve/checklist.md` (the single source). Improve scans all five; `check`/`run` skip them.

| Lens | Covers | Highest yield |
| --- | --- | --- |
| **P1** Architecture & SOLID | layer placement · `prisma.*` outside `src/lib/db/` · FE/BE leak · redesign that removes structure | — |
| **P2** KISS & duplication | repeated patterns across 2+ files · existing util / library idiom not applied · over-decompose · −LOC wins | ⭐ work hardest |
| **P3** Security & access | IDOR (`userId` from input) · missing Zod / auth check · webhook signature · stale cache granting wrong access | — |
| **P4** Bugs, regressions & logging | wrong branch / null edge · floating promise · missing/ noisy `createLogger` logs | — |
| **P5** Convention, hygiene & tests | `coding-standards` + `api-contract` (`apiRoute`/`ApiResponse`/`apiFetch`) · `'use client'` overuse · missing `.test.ts` | — |

**Constraints & discipline:**
- ✅ Prefer −LOC fixes (delete > merge > inline > refactor)
- ✅ No edits until user approves specific IDs
- ✅ All fixes together in single changeset
- ✅ Security + Testing findings are **always** reported, regardless of user approval
- ✅ **Analysis** is codebase-wide (find repeated patterns wherever they live); **edits** stay scoped to the changeset + the one shared file needed to dedupe
- ✅ When in doubt about a library's idiomatic API, **research via context7** instead of guessing — a missed simplification is a finding, not a pass
- ❌ No unrelated refactors unless they remove a repeated pattern the changeset participates in
- ❌ Cost O(files²) checks (unused exports, orphaned files) only if user explicitly asks
