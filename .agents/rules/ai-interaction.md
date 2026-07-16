---
trigger: always_on
description: How to work in this repo — scope discipline, the feature workflow, commit approval, and which verification gate to run per stack. Always applied, stack-agnostic. Next.js build/env/Prisma mechanics live in legacy-ops.md (glob-scoped).
---

# Working Agreement

**Must** / **never** = hard constraints.

## Defaults

- Minimal diffs; preserve existing patterns; no unrelated refactors.
- Only implement what `context/current-feature.md` specifies — no extras.
- **Ask** before large refactors, architectural changes, or deleting files.
- After 2–3 failed attempts, stop and explain instead of guessing.
- Library APIs, framework syntax, SDK behavior → invoke the `/context7-mcp` skill directly in the main conversation (never spawn a subagent for a Context7 lookup). Product decisions, scope questions, ambiguous requirements → ask the user.

## Feature workflow

1. **Document** — update `context/current-feature.md`.
2. **Branch** — `feature/<name>` or `fix/<name>`.
3. **Implement** to match the doc.
4. **Verify** — run the gate below; fix failures.
5. **Commit** — only after verification passes **and** the user explicitly asks.
6. **Close** — merge to `main`, delete the branch (ask first), mark complete in the feature doc, append to `context/history.md`.

## Verification

Run the targeted gate for the stack you touched — enough to prove the edited surface is correct, no more:

| Touched | Gate |
|---|---|
| `src/` (Next.js) | `legacy-ops.md` |
| `backend/` (Go) | `go-coding-standards.md § Testing` |
| `web/` (Vite SPA) | `web-architecture.md § Gates` |
| Docs only | Skip build/tests unless asked |

If a check fails and 2–3 attempts don't fix it: stop, explain clearly, wait for the user.

## Commits

**Never commit without the user asking, or while verification is failing.** Committing is irreversible — the user must see exactly what lands and approve it.

Before every commit:

1. **Show** what's changing — the files, with a one-line summary per group.
2. **Propose** the message — conventional prefix (`feat:` / `fix:` / `chore:`), stating the *why*, not the *what*.
3. **Ask** explicitly, and wait for confirmation.

One logical change per commit. Commit only the intended paths (`git commit -- <paths>`) — the IDE may have auto-staged unrelated working-tree changes. **Never** add AI attribution: no "Generated with Claude", no `Co-Authored-By`.
