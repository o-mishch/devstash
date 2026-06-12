---
description: AI collaboration guidelines for DevStash — workflow, commits, verification, builds, env vars, Prisma, Playwright. Loaded at every session start.
---

# AI Interaction Guidelines

**Must** / **never** = hard constraints.

## Quick Reference

| When | Section |
|------|---------|
| Every session | [Defaults](#defaults) |
| Starting/finishing work | [Feature Workflow](#feature-workflow) |
| Git operations | [Commits](#commits) |
| Verification & shipping | [Verification](#verification) |
| Production builds | [Builds](#production-build) |
| Config changes | [Environment](#environment-variables), [Prisma](#prisma), [Playwright](#playwright) |

---

## Defaults

**Scope & style:**
- Concise, direct tone
- Minimal diffs; preserve patterns; no unrelated refactors
- Only implement what `context/current-feature.md` specifies — no extras
- Ask before large refactors, architectural changes, or deleting files
- After 2–3 failed attempts, stop and explain instead of guessing

**When in doubt during implementation:**
- Library APIs, framework syntax, SDK behavior → research in Context7 first
- Product decisions, scope questions, ambiguous requirements → ask the user

**Tools:**
- **File changes:** Use IDE tools (Read, Edit, Write) — never CLI (cat/echo/sed)
- **Approvals:** Always via UI/IDE, never terminal output
- **Code review:** Show diffs visually; use AskUserQuestion for decisions

---

## Feature Workflow

1. **Document** — Update `context/current-feature.md`
2. **Branch** — Create `feature/<name>` or `fix/<name>`
3. **Implement** — Code to match the doc
4. **Verify** — Run verification checks; fix failures
5. **Iterate** — Adjust as needed
6. **Commit** — Only after verification passes AND user explicitly asks
7. **Merge** — Merge to `main`
8. **Close** — Delete branch (ask user); mark complete in feature doc; append to `context/history.md`

**Critical rule:** Never commit without user permission or while verification is failing.

---

## Commits

**Timing & style:**
- User must ask before committing
- Verification checks must pass first
- Conventional prefixes: `feat:`, `fix:`, `chore:`
- One logical change per commit
- **Never** add AI attribution (no "Generated with Claude", no Co-Authored-By)

**Approval Flow (before every commit):**

**Prerequisite:** Verify checks are green (lint + relevant tests). If failing, fix first — do not proceed to the steps below.

1. **Show what's changing** — List staged files with a brief summary (one sentence per file group)
2. **Propose the message** — Include conventional prefix and the "why" (not the "what")
3. **Ask explicitly** — "Ready to commit with this message?" — wait for confirmation

**Why:** Committing is irreversible. User must see exactly what's being committed and approve explicitly.

---

## Verification

Apply targeted checks that prove the edited surface is correct without excessive time/tokens.

| Change Type | Default Verification |
|---|---|
| **Docs only** | Skip build/tests unless user asks |
| **Server actions, utilities, API routes** | `npm run lint` + focused test file(s), or `npm run test:run` if scope is broad |
| **UI behavior** | `npm run lint` + browser test via Playwright |
| **Prisma/schema changes** | `prisma migrate dev`, `prisma migrate status`, relevant tests |
| **Refactors / broad changes** | `npm run lint` + `npm run test:run` |

**Never run `npm run build` routinely.** Only when:
- User explicitly requests production build
- Changes touch Next.js config, bundling, routes, rendering behavior, or deployment-only code
- Lint/test results leave unresolved build-only risk (and you explain why)

If build is skipped, state that and list the checks that ran instead.

**If a check fails and you cannot fix it after 2–3 attempts:** stop, explain the issue clearly, and wait for the user — do not keep guessing.

---

## Production Build

**Automatic cleanup, no user prompt.**

### When to build
- User explicitly asks
- Changes touch Next.js build config, bundling, routes, rendering, deployment
- Lint/test results leave build-only risk unresolved

### Preflight (always run first)
```bash
pgrep -fl 'next build|npm run build'    # Check for stale processes
pkill -f 'next build'                   # Kill them
pkill -f 'npm run build'
sleep 2
pgrep -fl 'next build|npm run build'    # Verify cleared
rm -rf .next                            # Clean artifacts
npm run build                           # Start fresh build
```

### During the build
**Claude Code:** Use `run_in_background: true`; you'll be notified on completion — do NOT poll.

**Progress signals** (if any appear, build is still running):
- New stdout/stderr output
- `.next/build/**`, `.next/server/**`, `.next/static/**`, `.next/types/**` writes
- `.next/lock` created/updated
- CPU or child workers on build PID

**If build appears stuck after ~30 seconds with no output:**
1. Run health check:
   ```bash
   pgrep -fl 'next build|npm run build'
   ps -o pid,pcpu,command -p <pid>
   find .next -type f -mmin -1 2>/dev/null | head
   ```
2. If truly stuck: run preflight again (kills + rebuilds)
3. If still stuck: stop, clear `.next`, report state — do NOT retry automatically

### After build completes
- If success: run `npm run test:run`
- If failure: report error, do not retry unless user asks

---

## Environment Variables

**Sync these together:**
- `src/types/env.d.ts` (use `?` for optional vars)
- `.env.example`

**Never add:**
| Var | Reason |
|-----|--------|
| `BILLING_ALERT_EMAIL`, `ADMIN_EMAIL` | Use `EMAIL_FROM` via `getNotificationRecipientEmail()` in `src/lib/infra/resend.ts` |
| `STRIPE_TRIAL_PERIOD_DAYS` | Configured in Stripe, not app env |
| `STRIPE_AUTOMATIC_TAX_ENABLED`, `CRON_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Reserved/pre-configured |

**Keep:**
- `STRIPE_PUBLISHABLE_KEY` in both files (reserved for future Stripe.js)

---

## Prisma

| Rule | Detail |
|------|--------|
| **Latest** | Use latest `prisma` + `@prisma/client` from npm (including `-dev` pre-releases) |
| **Match** | Same version in dependency and devDependency |
| **Upgrade** | Check npm; bump both + `@prisma/adapter-neon` when behind — no approval needed |
| **Never pin old** | Do not stay on older stable when newer exists |

---

## Playwright MCP

Browser verification for **UI behavior changes only** (see Verification table). Always close when done.

**Task → Tool:**
- Open: `browser_navigate` → `http://localhost:3000`
- Wait: `browser_wait_for` (selectors, not arbitrary delays)
- Screenshot: `browser_take_screenshot` → `.playwright-mcp/screenshots/`
- Console logs: `browser_console_messages` → `.playwright-mcp/logs/console-*.log`
- Page snapshots: `browser_snapshot` → `.playwright-mcp/logs/page-*.yml`
- Close: `browser_close` (always, even on error)

---

## Code Review Checklist

Before shipping, review for:
- **Security:** Auth checks, input validation, IDOR scoping
- **Performance:** Unnecessary re-renders, N+1 queries
- **Logic:** Edge cases, error paths
- **Patterns:** Consistency with existing codebase
