---
name: cleanup
description: Clean up project housekeeping tasks (add "run" to execute fixes)
argument-hint: run|check|improve
---

Review the codebase for cleanup tasks:

1. Make sure that the history in @context/current-feature.md is in order from oldest to newest
2. Find unnecessary console.log statements in src/
3. Find unused imports
4. Check for stale TODO comments
5. Find orphaned/unused files
6. Check that context files match actual project state
7. Check if the .env._production has the same variables (not always the same value) as the .env. If something is missing, tell me.
8. Find `@ts-ignore` comments that might be stale

**Mode: $ARGUMENTS**

If no argument is provided, respond with the following usage guide and stop — do not run any checks:

---

**Usage:** `/cleanup [argument]`

| Argument | Description |
| --- | --- |
| `check` *(default)* | Scan the codebase and report all findings — no changes made |
| `run` | Report findings, then ask which items to fix before making any changes |
| `improve` | Code quality review across clarity, architecture, naming, SOLID, and overengineering |

---

If the argument is "check":

- Only report findings, don't modify anything
- List what WOULD be cleaned up

If the argument is "run" or "fix":

- First, report all findings with numbered items
- Then ask: "Which items would you like me to fix? (enter numbers like 1,3,5 or 'all' or 'none')"
- Wait for user response before making any changes
- Only fix the items the user specifies
- Report what you changed

At the end of "run" mode, provide a summary report as a markdown table with columns: **#**, **Item**, **Status** (Fixed / Skipped), **Notes**.

If the argument is "improve":

**Scope:** Only review files that are currently uncommitted (modified, added, or deleted according to `git status`). For each changed file, also include files that are directly related (e.g. files that import or are imported by the changed files, shared types, or utilities they call) — but do NOT scan the entire codebase. Run `git diff --name-only HEAD` (and `git ls-files --others --exclude-standard` for untracked files) to get the list of files to review.

Review the scoped files from a code quality perspective. Evaluate each of the following dimensions and report findings grouped by severity (Major / Minor):

1. **Clarity & KISS** — logic that is harder to read than it needs to be; unnecessary abstraction; anything a new developer would stumble on
2. **Architecture & separation of concerns** — wrong layer doing wrong job; data fetching mixed with rendering; business logic leaking into UI
3. **Naming** — misleading, vague, or inconsistent names for variables, functions, files, types
4. **SOLID principles** — single-responsibility violations, unnecessary coupling, things that are hard to extend without modification
5. **Overdecomposition / overengineering** — abstractions that add complexity without payoff; files or components that don't justify their existence
6. **Regressions** — any pattern that looks like it could silently break existing behavior if changed
7. **SSR vs Client rendering** — components marked `'use client'` that may not need to be; opportunities to push client boundaries down; data fetching done client-side that could be done on the server

For the SSR check specifically, after listing all other findings, produce a dedicated **SSR Conversion Opportunities** table with these columns:

| File | Current | Can Convert? | Pros | Cons | Verdict |

- **Current**: `'use client'` or `server` (no directive)
- **Can Convert?**: Yes / Partial / No
- **Pros**: e.g. smaller JS bundle, no loading state, SEO, faster LCP
- **Cons**: e.g. needs interactivity, uses browser APIs, depends on a client-only library, requires event handlers or hooks
- **Verdict**: one of — `Convert`, `Convert with refactor`, `Keep client`, `Split component`

Rules for this mode:

- Always list the files being reviewed at the top so the scope is clear
- Minor improvements (renaming, small restructures, comment removal): report findings, then ask which to fix — same flow as "run" mode
- Major refactoring (moving files, restructuring layers, merging/splitting components): describe the purpose and concrete benefits first, then ask for confirmation before touching anything
- Never make major changes without explicit user approval
- Avoid suggesting changes that are purely stylistic preference with no real benefit
- For the SSR table: flag a component as `Partial` when only part of it needs interactivity — the fix is usually to split it so the server shell renders static content and a small client island handles the interactive part
