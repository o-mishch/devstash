# Improve Playbook

Goal: Produce a deep, skeptical audit of uncommitted code, then fix only approved finding IDs.

**Reviewer stance:** `improve-checklist.md § How to read code here` is the reviewing doctrine for this mode — the adversarial stance, the edge cases to enumerate, and the severity/confidence rubric all live there. Read it before step 1 and follow it; it is not a summary of this file, it is the substance.

**Research pass:** If subagent tools are available, spawn a foreground research subagent (single turn) for steps 1–8. The subagent prompt must be self-contained and list literal file paths for it to read: every rule file `resolve-context.sh improve` printed under "Rule files to read", plus `improve-checklist.md` and `improve-report.md`, plus every changed/untracked file. Do not pass it the always-on rules or `context/current-feature.md` — a subagent inherits `CLAUDE.md`, so those are already in its context and re-reading them buys nothing. The subagent returns only the fully rendered audit (using the `improve-report.md` template). If it returns an incomplete or partial audit (e.g. missing P-sections, no finding IDs, or fewer files reviewed than in scope), do not proceed to step 9 — report the gap and ask the user whether to re-run or continue inline. If subagents are unavailable, run steps 1–8 directly in the main thread.

1. Read the rule files `resolve-context.sh improve` listed, plus `improve-checklist.md` and `improve-report.md`.
2. Take the changed/untracked inventory from the same script output. If there is no changeset, say so and stop. Also run the housekeeping checks from `check-run.md § Check Mode` steps 1–2 and 6–7 (history.md order, current-feature.md alignment, Prisma migration sync, env drift).
3. Read every changed file in full — including the unchanged code around each hunk, not just the diff lines. A diff that looks correct in isolation can break an invariant three lines above or below it.
4. Widen context for changed code: callers (who passes what, and can they pass null/empty/untrusted), callees, siblings in the same directory, the tests that cover it, and similar existing implementations. Follow each changed value to where it is consumed. Read what the trace needs, not the whole directory — a sibling you cannot name a reason to open is one you should not open.
5. For every changed function, trace control and data flow end to end and enumerate the edge cases listed in `improve-checklist.md § How to read code here`. Treat an unhandled case as a finding unless you can name why it cannot occur.
6. Search for repeated non-trivial shapes across changed and unchanged code, per `improve-checklist.md § P2 - KISS and DRY`.
7. Check every reviewed file against every rule, per `improve-checklist.md § Rule Compliance`. Do not skip a rule because the violation looks minor.
8. Use Context7 when unsure whether a library or framework has a leaner idiomatic API, or whether the code uses an API correctly. Do not guess current library behavior. Then render the audit using `improve-report.md`.
9. Ask which finding IDs to fix. Accept IDs such as `P2-1`, `all major`, `all minor`, `all`, or `none`.
10. Apply only approved fixes and verify with `npm run lint`, focused tests or `npm run test:run` when behavior changed. Run `npm run build` only when the user explicitly requests it, or when the changes touch Next.js config, bundling, routes, rendering behavior, or deployment-only code — run the build preflight from `.agents/rules/legacy-ops.md § Production Build` first.
