---
trigger: glob
globs:
  - package.json
  - .env*
  - prisma/**/*
paths:
  - "package.json"
  - ".env*"
  - "prisma/**/*"
generated:
  - "package-lock.json"
description: Next.js-specific operational mechanics for DevStash (legacy, maintenance-only) — verification defaults, production build preflight, env var sync, Prisma version policy, and Playwright MCP usage. Loads when editing package.json, .env files, or prisma/. Stack-agnostic workflow/commit rules live in ai-interaction.md.
---

# Next.js Ops (legacy)

> `src/` is maintenance-only (see `boundary.md`). These are the concrete build/verification mechanics for the Next.js app; the stack-agnostic workflow, commit, and tone rules live in `ai-interaction.md`.

## Verification defaults

| Change Type | Default Verification |
|---|---|
| **Server actions, utilities, API routes** | `npm run lint` + focused test file(s), or `npm run test:run` if scope is broad |
| **UI behavior** | `npm run lint` + browser test via Playwright |
| **Prisma/schema changes** | `prisma migrate dev`, `prisma migrate status`, relevant tests |
| **Refactors / broad changes** | `npm run lint` + `npm run test:run` |

**Never run `npm run build` routinely.** Only when:
- User explicitly requests production build
- Changes touch Next.js config, bundling, routes, rendering behavior, or deployment-only code
- Lint/test results leave unresolved build-only risk (and you explain why)

If build is skipped, state that and list the checks that ran instead.

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

## Prisma

| Rule | Detail |
|------|--------|
| **Latest** | Use latest `prisma` + `@prisma/client` from npm (including `-dev` pre-releases) |
| **Match** | Same version in dependency and devDependency |
| **Upgrade** | Check npm; bump both + `@prisma/adapter-neon` when behind — no approval needed |
| **Never pin old** | Do not stay on older stable when newer exists |

## Playwright MCP

Browser verification for **UI behavior changes only** (see Verification defaults above). Always close when done.

**Task → Tool:**
- Open: `browser_navigate` → `http://localhost:3000`
- Wait: `browser_wait_for` (selectors, not arbitrary delays)
- Screenshot: `browser_take_screenshot` → `.playwright-mcp/screenshots/`
- Console logs: `browser_console_messages` → `.playwright-mcp/logs/console-*.log`
- Page snapshots: `browser_snapshot` → `.playwright-mcp/logs/page-*.yml`
- Close: `browser_close` (always, even on error)
