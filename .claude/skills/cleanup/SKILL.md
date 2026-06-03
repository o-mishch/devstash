---
name: cleanup
description: Clean up project housekeeping tasks, find issues, or review code quality
argument-hint: check|run|improve
---

You are an expert AI developer assistant performing housekeeping and cleanup on this project. 

**Current Mode: $ARGUMENTS**

## Mode Selection

If no argument is provided, stop immediately and reply ONLY with this usage guide:

> **Usage:** `/cleanup [argument]`
> 
> | Argument | Description |
> | --- | --- |
> | `check` *(default)* | Scan the codebase for housekeeping items and report findings — **no changes made** |
> | `run` | Same as `check`, but you will ask the user which items to automatically fix before proceeding |
> | `improve` | Run a code quality review across recently changed files (clarity, architecture, SOLID, etc.) |

---

## 🧹 Check & Run Modes (`check`, `run`, `fix`)

If the argument is `check`, `run`, or `fix`, evaluate the codebase for the following routine housekeeping tasks:

1. **Context files**: Check if `context/current-feature.md`'s history section is ordered from oldest to newest. Also, verify that other context files match the actual project state.
2. **Leftover debugging**: Find unnecessary `console.log` statements in `src/`.
3. **Dead code**: Find unused imports and orphaned/unused files.
4. **Stale comments**: Check for stale `TODO` or `FIXME` comments.
5. **Type overrides**: Find `@ts-ignore` or `@ts-expect-error` comments that might no longer be necessary.
6. **Environment variables**: Verify that `.env.production` has the same variables (not necessarily values) as `.env.example` or `.env`. Report any missing variables.

### Output Formatting
- First, list all findings as a numbered list.
- If the argument is `check`: **Stop here.** Do not modify anything.
- If the argument is `run` or `fix`: 
  - After listing the findings, ask: *"Which items would you like me to fix? (enter numbers like 1,3,5 or 'all' or 'none')"*
  - **Wait for user response.**
  - Once the user replies, fix only the specified items.
  - Finally, provide a summary report as a markdown table with columns: **#**, **Item**, **Status** (Fixed / Skipped / Error), **Notes**.

---

## 🛠️ Improve Mode (`improve`)

If the argument is `improve`, focus exclusively on code quality and architectural review.

### 1. Scope
Only review files that are currently uncommitted (modified, added, or deleted according to `git status`). 
- Run `git diff --name-only HEAD` and `git ls-files --others --exclude-standard` to get the list.
- Also include directly related files (e.g. files that import or are imported by the changed files, shared types, or utilities they call) to understand the context.
- **DO NOT scan the entire codebase.**
- Always list the scoped files at the beginning of your response.

### 2. Evaluation Criteria
Review the scoped files along these dimensions. Group your findings by severity (**Major** vs **Minor**):

1. **Clarity & KISS:** Logic that is overly complex or hard to read; unnecessary abstractions.
2. **Architecture & Separation of Concerns:** Wrong layer doing the wrong job (e.g. data fetching mixed with complex rendering, business logic leaking into UI).
3. **Naming:** Misleading, vague, or inconsistent names for variables, functions, files, or types.
4. **SOLID Principles:** Single-responsibility violations, unnecessary coupling, rigidity.
5. **Overengineering:** Abstractions that add complexity without payoff; components that don't justify their existence.
6. **Regressions:** Patterns that look like they could silently break existing behavior.
7. **SSR vs. Client Rendering:** Components marked `'use client'` that may not need to be; opportunities to push client boundaries down; client-side data fetching that could run on the server.

### 3. Output Requirements
- **SSR Conversion Opportunities Table:** After listing all other findings, you MUST produce a dedicated table for SSR optimization:
  | File | Current | Can Convert? | Pros | Cons | Verdict |
  - *Current:* `'use client'` or `server` (no directive)
  - *Can Convert?:* `Yes`, `Partial`, or `No` *(Use `Partial` when only part of it needs interactivity—suggesting a split)*
  - *Pros / Cons:* e.g. smaller JS bundle, no loading state, needs interactivity, browser APIs used
  - *Verdict:* `Convert`, `Convert with refactor`, `Keep client`, `Split component`

- **Rules of Engagement:**
  - Avoid purely stylistic preference suggestions.
  - **Minor improvements** (renaming, restructures, comment removal): Report findings, then ask which to fix (same flow as "run" mode).
  - **Major refactoring** (moving files, restructuring layers, merging/splitting components): Describe the purpose and concrete benefits first, then ask for explicit user approval before touching anything.
