---
name: cleanup
description: "Run DevStash housekeeping, cleanup fixes, or a deep quality audit over the current changeset. Use when asked to clean up, check before commit, find dead code, remove console/TODO leftovers, check env var drift, verify Prisma migration sync, simplify over-engineered code, or audit uncommitted work before shipping. Supports modes: check, run, improve."
# Claude Code specific fields — ignored by Codex
argument-hint: check|run|improve
allowed-tools: Agent, Glob, Grep, Read, Write, Edit, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs, Bash(git *), Bash(cd *), Bash(cd * && grep *), Bash(cd *; grep *), Bash(cd * && rg *), Bash(cd *; rg *), Bash(cd * && find *), Bash(cd *; find *), Bash(rg *), Bash(rg *; *), Bash(rg *| head *), Bash(grep *), Bash(grep * 2>/dev/null*), Bash(find *), Bash(find * 2>/dev/null*), Bash(ls *), Bash(ls *; *), Bash(ls *| head *), Bash(ls *2>/dev/null*), Bash(cat *), Bash(head *), Bash(tail *), Bash(sed *), Bash(awk *), Bash(echo *), Bash(cut *), Bash(tr *), Bash(for *), Bash(if *), Bash(while *), Bash(test *), Bash([ *), Bash(wc *), Bash(sort *), Bash(uniq *), Bash(xargs *), Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(npx prisma *), Bash(npx eslint *), Bash(npx tsc *), Bash(pgrep *), Bash(pkill *), Bash(lsof *), Bash(sleep *), Bash(ps *), Bash(mkdir *), Bash(mv *), Bash(ffmpeg *), Bash(ffprobe *), Bash(avconvert *), Bash(swift *), Bash(swift * 2>&1 | tail *), Bash(swift *| tail *), Bash(swift *; *)
---

# DevStash Cleanup

Use this skill to inspect or improve the current DevStash changeset. Resolve the mode from the user's request:

- `check`: Run a fast read-only scan (console logs, stale comments, lint, test coverage, env drift, Prisma sync) and report findings.
- `run`: Run the same scan, ask which findings to fix, apply approved fixes, then verify.
- `improve`: Run a deep audit for rule compliance, bugs, security, KISS, DRY, and tests.
- If no mode is supplied, show the usage table and stop.

**Mode resolution:** In Claude Code, `$ARGUMENTS` is substituted automatically — use it if substituted. In Codex, skills receive the full user request as natural language — extract the mode from phrases like "cleanup improve" or "run cleanup check". Do not treat a literal unsubstituted `$ARGUMENTS` as a mode.

## Usage

| Mode      | Behavior                                                          | Time      | When to use                               |
| --------- | ----------------------------------------------------------------- | --------- | ----------------------------------------- |
| `check`   | Read-only scan, numbered report, no edits                         | ~2–3 min  | Before commit or before asking for fixes  |
| `run`     | Scan, ask which findings to fix, edit only approved items, verify | ~3–4 min  | Basic cleanup with low ambiguity          |
| `improve` | Deep audit with finding IDs, then ask what to fix                 | ~5–10 min | Before shipping or after a broad refactor |

## Scope Snapshot

Take before any mode:

```bash
git status --porcelain
```

Treat the dirty worktree as shared user work. Never revert unrelated changes.

## Required Context

| File                                   | check |  run  | improve |
| -------------------------------------- | :---: | :---: | :-----: |
| `.agents/rules/ai-interaction.md`      |   ✓   |   ✓   |    ✓    |
| `.agents/rules/coding-standards.md`    |   ✓   |   ✓   |    ✓    |
| `context/current-feature.md`           |   ✓   |   ✓   |    ✓    |
| `.agents/rules/nextjs-architecture.md` | scope | scope |    ✓    |
| `.agents/rules/database.md`            | scope | scope |    ✓    |
| `.agents/rules/security.md`            | scope | scope |    ✓    |
| `.agents/rules/api-contract.md`        | scope | scope |    ✓    |
| `.agents/rules/testing.md`             | scope | scope |    ✓    |
| `references/improve-checklist.md`      |   —   |   —   |    ✓    |
| `references/improve-report.md`         |   —   |   —   |    ✓    |

**✓** = always read. **scope** = read only when changed paths match the table below. **—** = skip.

Path triggers for scope-gated rule files:

| Changed paths                                                                                                                                                     | Rule file                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/**/*.ts`, `src/**/*.tsx`                                                                                                                                     | `nextjs-architecture.md` |
| `src/lib/db/**/*`, `prisma/**/*`                                                                                                                                  | `database.md`            |
| `src/app/api/**/*`, `src/actions/**/*`, `src/auth.ts`, `src/auth.config.ts`, `src/lib/auth/**/*`, `src/lib/infra/rate-limit.ts`, `src/lib/db/**/*`, `prisma/**/*` | `security.md`            |
| `src/app/api/**/*`, `src/actions/**/*`, `src/lib/api/**/*`, `src/types/api.ts`                                                                                    | `api-contract.md`        |
| `src/**/*.test.ts`, `src/test/**/*`, `vitest.config*`                                                                                                             | `testing.md`             |

Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in scope.

## Shared Rules

- Announce edits before making them.
- Do not commit unless the user explicitly asks.
- Do not delete or revert files unless the user requested that cleanup or explicitly approved the finding.
- Keep fixes scoped to the current changeset, plus one shared helper file when it removes duplication that the changeset participates in.
- Prefer deletion, merge, and inline simplification before adding abstractions.
- Verify edited code before reporting done. For docs-only skill edits (changes to files inside `.agents/skills/`), no app lint or tests are required — re-read the edited skill file to confirm correctness instead.

## Check Mode

Run this read-only scan and report numbered findings with severity, file refs, and remediation hints:

1. Verify `context/history.md` is chronological from oldest to newest.
2. Verify `context/current-feature.md` goals and notes match the changeset. Do not edit `## Status`.
3. Search for accidental logs: `rg 'console\.(log|warn|error|debug)' src/`.
4. Search for stale comments: `rg '(TODO|FIXME|HACK)' src/`.
5. Search for TypeScript pragmas: `rg '@ts-(ignore|expect-error)' src/`.
6. If `prisma/schema.prisma` changed, run `npx prisma migrate status` and confirm a migration exists.
7. If env files or env types changed, compare `.env.example`, `.env`, `.env.local`, `.env._production`, and `src/types/env.d.ts`.
8. Run `npm run lint`.
9. Check changed `src/actions/*.ts`, `src/app/api/**/route.ts`, and non-DB `src/lib/**/*.ts` for meaningful `*.test.ts` coverage.

Stop after the report. Do not edit in `check` mode.

## Run Mode

Run `check` mode first. Then ask:

```
Which checks should I fix? Reply with numbers, all, or none.
```

Apply only the approved fixes. Verify with the narrowest relevant checks:

- Docs-only cleanup: no app lint/tests required.
- Source cleanup: `npm run lint` plus focused tests when action/lib behavior changed.
- Prisma cleanup: `npx prisma migrate status` plus relevant tests.

Return a compact summary table with columns: check, status, notes.

## Improve Mode

Goal: Produce a deep, skeptical audit of uncommitted code, then fix only approved finding IDs.

**Reviewer stance:** Audit like an adversarial senior reviewer who assumes the code is wrong until proven right, not a proofreader skimming for typos. Your job is to find what breaks, not to confirm it works. A clean report is a claim you must earn: for every changed function you must either raise a finding or be able to state the specific reason it is safe. "Looks fine" is not a conclusion — it is the absence of analysis. Bias toward surfacing issues: a low-confidence finding that proves false costs a sentence; a missed bug ships. Never soften severity to make the report look calmer, and never collapse two distinct problems into one finding to shorten the list.

**Research pass:** If subagent tools are available, spawn a foreground research subagent (single turn) for steps 1–9. The subagent prompt must be self-contained and explicitly list these file paths for it to read: every file under `.agents/rules/`, plus `references/improve-checklist.md` and `references/improve-report.md`, and every changed/untracked file from the scope snapshot. The subagent returns only the fully rendered audit (using the `references/improve-report.md` template). If the subagent returns an incomplete or partial audit (e.g. missing P-sections, no finding IDs, or fewer files reviewed than in scope), do not proceed to step 10 — report the gap and ask the user whether to re-run or continue inline. If subagents are unavailable, run steps 1–9 directly in the main thread.

1. Read all files marked ✓ in the Required Context table, plus `references/improve-checklist.md` and `references/improve-report.md`.
2. Inventory changed and untracked files (`git status --porcelain`). If there is no changeset, say so and stop. Also run the housekeeping checks from Check Mode steps 1–2 and 6–7 (history.md order, current-feature.md alignment, Prisma migration sync, env drift).
3. Read every changed file in full — including the unchanged code around each hunk, not just the diff lines. A diff that looks correct in isolation can break an invariant three lines above or below it.
4. Widen context for changed code: callers (who passes what, and can they pass null/empty/untrusted), callees, siblings in the same directory, the tests that cover it, and similar existing implementations. Follow each changed value to where it is consumed.
5. For every changed function, trace control and data flow end to end and enumerate the edge cases explicitly: null/undefined/empty input, zero/negative/boundary numbers, empty collections, the error path, partial failure mid-write, concurrent callers, and stale cache. Treat an unhandled case as a finding unless you can name why it cannot occur.
6. Search for repeated non-trivial shapes across changed and unchanged code: guards, data transforms, API error mapping, prop interfaces, token handling, auth checks, cache invalidation, and fetch/mutation patterns. A near-duplicate with one differing line still counts.
7. Check every reviewed file against every rule. A rule violation is a finding; cite the rule file and section. Do not skip a rule because the violation looks minor.
8. Use Context7 when unsure whether a library or framework has a leaner idiomatic API, or whether the code uses an API correctly. Do not guess current library behavior.
9. Render the audit using `references/improve-report.md`. Assign each finding a confidence (high/medium/low); low-confidence findings still ship in the report, flagged as such.
10. Ask which finding IDs to fix. Accept IDs such as `P2-1`, `all major`, `all minor`, `all`, or `none`.
11. Apply only approved fixes and verify with `npm run lint`, focused tests or `npm run test:run` when behavior changed. Run `npm run build` only when the user explicitly requests it, or when the changes touch Next.js config, bundling, routes, rendering behavior, or deployment-only code — run the build preflight from `.agents/rules/ai-interaction.md § Production Build` first.

## Output Style

- Lead with findings, not process.
- Use clickable file references when reporting local files.
- Keep reports concise in `check` and `run`; use the report template for `improve`.
- If a check cannot run, say exactly why and what risk remains.
