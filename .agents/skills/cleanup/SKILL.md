---
name: cleanup
description: "Run DevStash housekeeping, cleanup fixes, a deep quality audit, or a public-exposure secret/PII scan over the repo. Use when asked to clean up, check before commit, find dead code, remove console/TODO leftovers, check env var drift, verify Prisma migration sync, simplify over-engineered code, audit uncommitted work before shipping, or scan the repo for leaked secrets/keys/tokens/PII before or after making it public. Supports modes: check, run, improve, public."
argument-hint: check|run|improve|public
allowed-tools: Agent, Glob, Grep, Read, Write, Edit, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs, Bash(git *), Bash(cd *), Bash(cd * && grep *), Bash(cd *; grep *), Bash(cd * && rg *), Bash(cd *; rg *), Bash(cd * && find *), Bash(cd *; find *), Bash(rg *), Bash(rg *; *), Bash(rg *| head *), Bash(grep *), Bash(grep * 2>/dev/null*), Bash(find *), Bash(find * 2>/dev/null*), Bash(ls *), Bash(ls *; *), Bash(ls *| head *), Bash(ls *2>/dev/null*), Bash(cat *), Bash(head *), Bash(tail *), Bash(sed *), Bash(awk *), Bash(echo *), Bash(cut *), Bash(tr *), Bash(for *), Bash(if *), Bash(while *), Bash(test *), Bash([ *), Bash(wc *), Bash(sort *), Bash(uniq *), Bash(xargs *), Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(npx prisma *), Bash(npx eslint *), Bash(npx tsc *), Bash(npx secretlint *), Bash(pgrep *), Bash(pkill *), Bash(lsof *), Bash(sleep *), Bash(ps *), Bash(mkdir *), Bash(mv *), Bash(ffmpeg *), Bash(ffprobe *), Bash(avconvert *), Bash(swift *), Bash(swift * 2>&1 | tail *), Bash(swift *| tail *), Bash(swift *; *), Bash(command -v *), Bash(gitleaks *), Bash(${CLAUDE_SKILL_DIR}/scripts/scan-git-history.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-context.sh *), Bash(jq *)
---

# DevStash Cleanup

Inspect or improve the current DevStash changeset. The mode is `$ARGUMENTS`. Read that mode's playbook below and follow it.

## Scope and context

This ran before you saw this file — it is the changeset and the exact rule files this changeset requires:

!`${CLAUDE_SKILL_DIR}/scripts/resolve-context.sh $ARGUMENTS`

Read every rule file listed under **Rule files to read**, and nothing beyond them. The list is derived from each rule's own `paths:` frontmatter — the only field Claude Code scopes on — so it stays correct as rules are added or their globs change. A second copy of that mapping in this file would drift, and did.

**Do not read anything listed under "Already in context".** Those rules have no `paths:` frontmatter, so they load at launch, and `context/current-feature.md` arrives via `CLAUDE.md`'s `@` import — a subagent inherits them too. Reading them again duplicates them for nothing. They still bind; you just already have them.

If the output says **No mode**, show the Usage table and stop. If it reports **Frontmatter warnings**, surface them — a rule's `paths:` and `trigger:` keys have fallen out of sync.

Treat the dirty worktree as shared user work. Never revert unrelated changes. Honor `context/current-feature.md` when it explicitly supersedes a standing rule for files in scope.

## Usage

| Mode      | Behavior                                                          | Time      | When to use                                               |
| --------- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| `check`   | Read-only scan, numbered report, no edits                         | ~2–3 min  | Before commit or before asking for fixes                  |
| `run`     | Scan, ask which findings to fix, edit only approved items, verify | ~3–4 min  | Basic cleanup with low ambiguity                          |
| `improve` | Deep audit with finding IDs, then ask what to fix                 | ~5–10 min | Before shipping or after a broad refactor                 |
| `public`  | Secret/PII scan of working tree + full git history, report only   | ~5–15 min | Before or after making the repo public; periodic re-audit |

## Playbooks

Read every file listed for your mode, in full, before acting — each is the procedure itself, not a summary of one. Read only your own mode's row; the four are mutually exclusive, and loading another mode's files is waste.

| Mode        | Files                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`     | `references/check-run.md`                                                                                                                                   |
| `run`       | `references/check-run.md`                                                                                                                                   |
| `improve`   | `references/improve.md` — procedure<br>`references/improve-checklist.md` — reviewing doctrine and severity rubric<br>`references/improve-report.md` — output template |
| `public`    | `references/public.md` — procedure<br>`references/public-checklist.md` — tier and severity rubric<br>`references/public-report.md` — output template          |

Every file above is listed here, one level from this file, on purpose: a reference reached only through another reference tends to get previewed with a partial read rather than read whole, which would silently drop the tail of a rubric.

## Shared Rules

- Announce edits before making them.
- Do not commit unless the user explicitly asks.
- Do not delete or revert files unless the user requested that cleanup or explicitly approved the finding.
- Keep fixes scoped to the current changeset, plus one shared helper file when it removes duplication that the changeset participates in.
- Prefer deletion, merge, and inline simplification before adding abstractions.
- Verify edited code before reporting done. For docs-only skill edits (changes to files inside `.agents/skills/`), no app lint or tests are required — re-read the edited skill file to confirm correctness instead.
- `public` mode is report-only: never rotate a credential, edit `.gitignore`, delete a file, or rewrite git history without the user picking that specific finding ID first. It scans the whole repo, not the current changeset — the "scoped to current changeset" rule above does not apply to it.

## Output Style

- Lead with findings, not process.
- Use clickable file references when reporting local files.
- Keep reports concise in `check` and `run`; use the report template for `improve` and `public`.
- If a check cannot run, say exactly why and what risk remains.
- In `public` mode, never echo a raw secret value into chat output — describe it, don't quote it.
