---
description: AI collaboration guidelines for DevStash — workflow, commits, Codex verification limits, frozen/hung recovery, env vars, Prisma, Playwright. Loaded at every session start.
---

# AI Interaction Guidelines

**Must** / **never** = hard constraints.

## Quick nav

| Section | Read when |
| --- | --- |
| [Defaults](#defaults) | Every session |
| [Feature workflow](#feature-workflow) | Starting or finishing work |
| [Branching & commits](#branching--commits) | Git operations |
| [Verification](#verification) | Choosing lint/test/build checks before shipping |
| [Production build](#production-build) | Only when explicitly needed; build preflight, monitoring, recovery |
| [Environment variables](#environment-variables) | Adding or changing env vars |
| [Prisma](#prisma) | Touching Prisma deps in `package.json` |
| [Code review](#code-review) | Before shipping |
| [Playwright](#playwright-mcp-user-playwright) | Browser verification |

## Defaults

| Topic | Rule |
| --- | --- |
| Tone | Concise and direct; explain non-obvious decisions briefly |
| Scope | Minimal diffs; preserve existing patterns; no unrelated refactors |
| Features | Only what `context/current-feature.md` specifies — no extras |
| Clarify | Ask before large refactors, architectural changes, or deleting files |
| Stuck | After 2–3 failed attempts, stop and explain — do not keep guessing |

## Feature workflow

| Step | Action |
| ---: | --- |
| 1 | **Document** — `context/current-feature.md` |
| 2 | **Branch** — `feature/<name>` or `fix/<name>` |
| 3 | **Implement** — match the doc |
| 4 | **Verify** — browser verify when UI changed; [Verification](#verification) flow; fix failures |
| 5 | **Iterate** — adjust as needed |
| 6 | **Commit** — required verification passes **and** user explicitly asks |
| 7 | **Merge** — to `main` |
| 8 | **Delete branch** — after merge (ask user) |
| 9 | **Review** — [Code review](#code-review) |
| 10 | **Close out** — mark complete in `context/current-feature.md`; append to **end** of `context/history.md` (oldest → newest) |

**Never** commit without user permission or while required verification is failing.

## Branching & commits

| Topic | Rule |
| --- | --- |
| Branch naming | `feature/<name>` or `fix/<name>` — one branch per feature/fix |
| Commit timing | User must ask; required verification must pass first |
| Commit style | Conventional prefixes (`feat:`, `fix:`, `chore:`); one logical change per commit |
| Attribution | **Never** AI attribution — no "Generated with …", no `Co-Authored-By` trailers |

## Verification

Prefer targeted checks that prove the edited surface is correct without spending excessive time or tokens.

| Change type | Default verification |
| --- | --- |
| Docs-only | No build; no tests unless requested |
| Server actions, utilities, API routes | `npm run lint` + focused Vitest file(s), or `npm run test:run` when scope is broad |
| UI behavior | `npm run lint` + browser verification through Playwright when practical |
| Prisma/schema changes | `prisma migrate dev`; `prisma migrate status`; relevant tests |
| Shared contracts or broad refactors | `npm run lint` + `npm run test:run`; consider build only if user asks or risk demands it |

Do **not** run `npm run build` as routine pre-commit or close-out verification. Run it only when:

- The user explicitly asks for a production build.
- The change touches Next.js build config, bundling, route generation, dynamic/static rendering behavior, or deployment-only code paths.
- A lint/test/browser result leaves a specific build-only risk unresolved, and you explain why the build is worth running.

**Codex:** avoid `npm run build` especially — it consumes tokens through long-running process monitoring.

If a build is skipped, say so in the final response and list the lighter checks that were run.

## Production build

Automatic cleanup — **no user prompt** unless noted. Run each phase as **separate terminal commands** (never chain; never pipe through `tail`/`head`/`grep`).

Treat a production build as a bounded check, not a process to babysit. Avoid stale `npm run build` / `next build` processes and repeated quiet polls.

### Flow

| Phase | When | Section |
| --- | --- | --- |
| 1 Preflight | Before every `npm run build` | [below](#preflight) |
| 2 Build | After preflight | `npm run build` |
| 3 Monitor | While build runs | [below](#monitor) |
| 4 Recovery | Hung build or lock error | [below](#recovery) |
| 5 Tests | After build passes | `npm run test:run` |

One build/test at a time.

### Reset stale builds

Shared by preflight and recovery.

```bash
pgrep -fl 'next build|npm run build'    # note PIDs
pkill -f 'next build'
pkill -f 'npm run build'
sleep 2
pgrep -fl 'next build|npm run build'    # repeat pkill once if still running
rm -rf .next
```

### Preflight

Run [reset](#reset-stale-builds) then start build.

| Step | Action |
| ---: | --- |
| 1–3 | [Reset stale builds](#reset-stale-builds) |
| 4 | `npm run build` → [Monitor](#monitor) (Claude Code: `run_in_background: true`; Codex: fresh session) |

### Monitor

Keep polls internal — no passive status narration unless the user asks.

**Progress signals** (any one = still running):

| Signal | Notes |
| --- | --- |
| New stdout/stderr | — |
| `.next/build/**`, `.next/server/**`, `.next/static/**`, `.next/types/**`, `.next/diagnostics/**` writes | Production output |
| `.next/lock` created or updated | — |
| CPU or child workers on build PID | — |
| `.next/dev/**` only | **Ignore** — usually `next dev` |

**Agent polling** — use only your runtime row:

| Agent | How |
| --- | --- |
| **Claude Code** | Use `run_in_background: true` on the Bash tool; you will be notified on completion — do **not** poll |
| **Cursor** | High `block_until_ms`; poll same shell with `Await` until exit |
| **Codex** | `yield_time_ms` up to 30000; poll same session id — **not** `block_until_ms` / `Await` |

**Codex-specific limit:** never run a long verification loop. Do not keep repeatedly polling a quiet build/test session just to watch it. After the initial wait, do at most **one** quick progress check. If that poll is quiet, run one health check; if health is ambiguous or idle, stop the build, clear `.next`, and report instead of retrying by default.

**Health check** (~30s with no new output — separate commands):

```bash
pgrep -fl 'next build|npm run build'
ps -o pid,pcpu,command -p <pid>
find .next/build .next/server .next/static .next/types .next/diagnostics -type f -mmin -1 2>/dev/null | head
```

Also note elapsed time since build started.

**States:**

| State | Criteria | Action |
| --- | --- | --- |
| Running | Output or progress signal within ~30s | Claude Code: wait for notification; Codex: one more poll max; Cursor may keep polling |
| Suspicious | No output **and** no progress | Run health check |
| Hung | No output, no `.next` writes, no CPU/workers | [Recovery](#recovery) |
| Lock error | "Another next build process is already running" | [Recovery](#recovery) once |

### Recovery

Hung or lock error — automatic cleanup, no approval.

| Step | Action |
| ---: | --- |
| 1 | Stop all matching build processes with [Reset stale builds](#reset-stale-builds) |
| 2 | One-line report: elapsed time, PIDs killed, health-check results |
| 3 | Codex / Claude Code: **do not retry automatically** after a confirmed hung build; ask or wait for explicit user instruction |
| 4 | Cursor or explicitly requested retry: retry `npm run build` **once** (`run_in_background: true` for Claude Code; fresh session for Cursor/Codex) |
| 5 | Retry still hung or lock again → stop, clear `.next`, report state; do not loop |

## Environment variables

Sync `src/types/env.d.ts` and `.env.example` in the same change. Use `?` in `env.d.ts` for optional vars.

| Policy | Vars |
| --- | --- |
| **Never add** | `BILLING_ALERT_EMAIL`, `ADMIN_EMAIL` — use `EMAIL_FROM` via `getNotificationRecipientEmail()` in `src/lib/infra/resend.ts` |
| **Never add** | `STRIPE_TRIAL_PERIOD_DAYS` — configured in Stripe, not app env |
| **Never add** | `STRIPE_AUTOMATIC_TAX_ENABLED`, `CRON_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| **Keep** | `STRIPE_PUBLISHABLE_KEY` in both files — reserved for future Stripe.js |

## Prisma

| Rule | Detail |
| --- | --- |
| Latest | `prisma` + `@prisma/client` on latest npm (including `-dev` pre-releases) |
| Match | Same version in devDependency and dependency |
| Bump | Check npm; bump both + `@prisma/adapter-neon` when behind — no approval needed |
| Never pin old | Do not stay on older stable when newer exists |

## Code review

| Area | Look for |
| --- | --- |
| Security | Auth checks, input validation, IDOR scoping |
| Performance | Unnecessary re-renders, N+1 queries |
| Logic | Edge cases, error paths |
| Patterns | Consistency with existing codebase |

## Playwright MCP (`user-playwright`)

Browser verification (workflow step 4). Always `browser_close` when done.

| Task | Tool |
| --- | --- |
| Open | `browser_navigate` → `http://localhost:3000` |
| Wait | `browser_wait_for` (selectors, not arbitrary delays) |
| Screenshot | `browser_take_screenshot` |
| Inspect | `browser_snapshot`, `browser_console_messages` |
| Close | `browser_close` |
