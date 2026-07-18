---
name: cleanup
description: "Runs DevStash housekeeping, cleanup fixes, a deep quality audit, or a public-exposure secret/PII scan over the repo. Use when asked to clean up, check before commit, find dead code, remove console/TODO leftovers, check env var drift, verify Prisma migration sync, simplify over-engineered code, audit uncommitted work before shipping, or scan the repo for leaked secrets/keys/tokens/PII before or after making it public. Supports modes: check, run, improve, public."
argument-hint: check|run|improve|public
allowed-tools: Agent, Workflow, Glob, Grep, Read, Write, Edit, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs, Bash(node *), Bash(node --test *), Bash(npx jscpd@* *), Bash(git *), Bash(cd *), Bash(cd * && grep *), Bash(cd *; grep *), Bash(cd * && rg *), Bash(cd *; rg *), Bash(cd * && find *), Bash(cd *; find *), Bash(rg *), Bash(rg *; *), Bash(rg *| head *), Bash(grep *), Bash(grep * 2>/dev/null*), Bash(find *), Bash(find * 2>/dev/null*), Bash(ls *), Bash(ls *; *), Bash(ls *| head *), Bash(ls *2>/dev/null*), Bash(cat *), Bash(head *), Bash(tail *), Bash(sed *), Bash(awk *), Bash(echo *), Bash(cut *), Bash(tr *), Bash(for *), Bash(if *), Bash(while *), Bash(test *), Bash([ *), Bash(wc *), Bash(sort *), Bash(uniq *), Bash(xargs *), Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(npx prisma *), Bash(npx eslint *), Bash(npx tsc *), Bash(npx secretlint *), Bash(pgrep *), Bash(pkill *), Bash(lsof *), Bash(sleep *), Bash(ps *), Bash(mkdir *), Bash(mv *), Bash(ffmpeg *), Bash(ffprobe *), Bash(avconvert *), Bash(swift *), Bash(swift * 2>&1 | tail *), Bash(swift *| tail *), Bash(swift *; *), Bash(command -v *), Bash(gitleaks *), Bash(jq *)
---

# DevStash Cleanup

Inspect or improve the current DevStash changeset. The mode is `$ARGUMENTS`. Read that mode's playbook below and follow it.

## Scope and context

This ran before you saw this file — it is the changeset summary and the exact rule files it requires:

!`node ${CLAUDE_SKILL_DIR}/scripts/resolve-context.ts $ARGUMENTS`

Read every rule file listed under **Rule files to read**, and nothing beyond them. The list is derived from each rule's own `paths:` frontmatter, so it stays correct as rules change.

**Do not read anything listed under "Already in context"** — those rules load at launch and a subagent inherits them. They still bind; you just already have them.

The full file list is written to `.cleanup-changeset.txt`, not printed. Read it only if you need the filenames themselves — `improve` does not (it enumerates its own groups) and `public` does not (it scans the whole repo).

Stop conditions:

- **No mode** — show the Usage table and stop.
- **Cannot resolve context** — report it and stop. The changeset is unknown, so every mode would be scanning something it cannot see.
- **Frontmatter warnings** — surface them; a rule's `paths:` and `trigger:` have fallen out of sync.

Treat the dirty worktree as shared user work. Never revert unrelated changes. Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in scope.

## Usage

| Mode      | Behavior                                                          | Time      | When to use                                               |
| --------- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| `check`   | Read-only scan, numbered report, no edits                         | ~2–3 min  | Before commit or before asking for fixes                  |
| `run`     | Scan, ask which findings to fix, edit only approved items, verify | ~3–4 min  | Basic cleanup with low ambiguity                          |
| `improve` | Exhaustive fan-out audit with finding IDs, then ask what to fix   | ~10–20 min, **~100 agents** | Before shipping or after a broad refactor |
| `public`  | Secret/PII scan of working tree + full git history, report only   | ~5–15 min | Before or after making the repo public; periodic re-audit |

`improve` is the expensive one: it fans out one agent per (group × unit), so its agent count scales with the changeset. `plan-improve.ts` prints the exact number before any of them are spawned — **say that number to the user before fanning out.** On a small changeset (at or below `plan-improve.ts`'s `QUICK_TIER_GROUP_THRESHOLD` groups) it auto-downgrades to a quick tier: every group merges to one unit and the Verify refutation pass is skipped. `plan-improve.ts`'s output says so explicitly — say it to the user before fanning out, same as the agent count, and the report must carry it too (`references/improve-report.md`'s Coverage table).

## Playbooks

Read every file listed for your mode, in full, before acting — each is the procedure itself, not a summary of one. Read only your own mode's row.

| Mode        | Files                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`     | `references/check-run.md` — procedure<br>`references/housekeeping.md` — the four repo-bookkeeping checks                                                     |
| `run`       | `references/check-run.md` — procedure<br>`references/housekeeping.md` — the four repo-bookkeeping checks                                                     |
| `improve`   | `references/improve.md` — procedure<br>`references/improve/common.md` — severity rubric, so you can judge what the fan-out returns<br>`references/improve-report.md` — output template<br>`references/housekeeping.md` — the four repo-bookkeeping checks<br>`workflows/improve-audit.js` — the fan-out; invoked via the `Workflow` tool, never read |
| `public`    | `references/public.md` — procedure<br>`references/public-checklist.md` — tier and severity rubric<br>`references/public-report.md` — output template          |

Every file above is listed here, one level from this file, on purpose — a reference reached only through another reference gets previewed with a partial read, which silently drops the tail of a rubric. `housekeeping.md` appearing in three rows is that rule working, not a duplicate; do not collapse it into a mention inside another playbook.

The one exception is `references/improve/` — the per-lens fragments the fan-out agents read. They are addressed by `improve-audit.js` with explicit paths, never reached by you through a chain of references. Do not read them yourself beyond `common.md`.

Structural rationale for the whole skill lives in `DESIGN.md`. **No agent reads it** — that is the point. Read it before changing the skill's structure, never during a run.

## Shared Rules

- Announce edits before making them.
- Do not commit unless the user explicitly asks.
- Do not delete or revert files unless the user requested that cleanup or explicitly approved the finding.
- Keep fixes scoped to the current changeset, plus one shared helper file when it removes duplication that the changeset participates in.
- Prefer deletion, merge, and inline simplification before adding abstractions.
- Verify edited code before reporting done. For docs-only skill edits (changes inside `.agents/skills/`), no app lint or tests are required — re-read the edited file to confirm correctness instead.
- `public` mode is report-only: never rotate a credential, edit `.gitignore`, delete a file, or rewrite git history without the user picking that specific finding ID first. It scans the whole repo, not the current changeset — the "scoped to current changeset" rule above does not apply to it.
- **The codebase is the only source of truth.** `improve`'s findings ledger (`context/cleanup-findings.md`, gitignored) is a cache that labels a finding `new`/`known`/`fixed` across runs. It never suppresses work, never skips a unit, and never stands in for reading the code.
- **Scripts are the coverage guarantee, not a convenience.** `improve` enumerates its work in `plan-improve.ts` and fans out over it. Do not replace that with "read the files carefully" — one reviewer sampling hundreds of units is the bug this mode was rebuilt to fix.

## Output Style

- Lead with findings, not process.
- Use clickable file references when reporting local files.
- Keep reports concise in `check` and `run`; use the report template for `improve` and `public`.
- If a check cannot run, say exactly why and what risk remains.
- In `public` mode, never echo a raw secret value into chat output — describe it, don't quote it.
