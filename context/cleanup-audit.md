# Cleanup Improve Audit

> Prior-run notebook for `/cleanup improve`. **Every table row challenged each run** — never passed as ignored. **History** = append only.

**Last run:** #5 · 2026-06-09 · 285 files · LOC src +1050 −5459 (net −4409)

## Next-run context

Stripe billing + lib reorganization changeset. All improve findings through Run #5 resolved. ESLint clean, 530 tests pass, build pass. No open audit items.

### Implemented (prior fixes — challenge in code each run)

| ID | What was done | Why | Key files | Verify |
| --- | --- | --- | --- | --- |
| P2-1 | Merged upsert into `stripe-subscription-persist.ts` | Single persist path; deleted `stripe-subscription-upsert.ts` | `stripe-subscription-persist.ts` | `upsertSubscriptionStateFromObject` + `isSubscriptionUpsertEvent` in persist |
| P2-2 | Merged resolve into `subscription-state.ts` | One canonical write/resolve module | `subscription-state.ts` | `resolveAppUserIdForSubscription` in subscription-state |
| P2-3 | Moved hint strings to client module | Pure UI copy; no server-only in sections | `billing-messages.client.ts` | sections import `.client` |
| P2-4 | Upgrade page imports `.client` constants | Avoid server-only barrel for display copy | `upgrade/page.tsx` | import path |
| P2-5 | Moved lifecycle to `lib/billing/lifecycle/` | Profile-only consumer; billing domain | `stripe-billing-lifecycle.ts`, `profile.ts` | `teardownStripeBillingForUser` in profile delete |
| P4-1 | Removed `customer.updated` from required events + handler | Log-only handler; app→Stripe email sync only | `stripe-webhook-config.ts` | not in `REQUIRED_STRIPE_WEBHOOK_EVENTS` |
| P5-1 | Fixed feature doc webhook path | `constants.ts` never existed | `context/current-feature.md` | cites `stripe-webhook-config.ts` |
| P1-1 | Targeted merges only (no redesign) | Sufficiency pass without broad refactor | billing module | ~47 billing source files after subpackaging |
| P2-7 | Merged orphan tests; deleted stale filenames | Tests kept pre-merge names after module merge | `stripe-subscription-persist.test.ts`, `subscription-state.test.ts` | no `*-upsert.test.ts` or `resolve-app-user*.test.ts` |
| P5-2 | Moved display helpers to lib | Project convention: no component tests | `billing-subscription-display.ts` | test in `lib/billing/subscription/` |
| P5-3 | Named collections page searchParams | coding-standards inline-type rule | `collections/page.tsx` | `CollectionsPageSearchParams` interface |
| P4-2 | Fixed env validator logger import | Build failed after lib reorg | `validate-billing-env.ts` | relative `../lib/infra/logger` (next.config has no `@/`) |
| P1-2 | Constants from `utils/constants` not `db/usage` | Client components must not transitively import prisma | 5 component files | no client `@/lib/db/usage`; server `billing-settings.tsx` OK |
| P5-4 | Updated agent rules + vitest coverage paths | Stale paths after lib reorg | `.agents/rules/*`, `vitest.config.ts` | no old paths in `.agents/rules` |
| P5-5 | Updated File Organization in coding-standards | Reflect subpackaged `lib/` layout | `.agents/rules/coding-standards.md` | lists `db/`, `billing/`, `infra/`, etc. |

_Claimed fixes. Run **Verify** in code every run; report ✅ Holds or ⚠️ Regression._

### Accepted tradeoffs (user decided — challenge still applies)

| ID | What we chose | Why not the alternative |
| --- | --- | --- |
| P1-1 | ~47 billing source modules remain after merges | Full consolidation would touch every webhook/sync path for marginal gain |

_Conscious deferrals. Re-check in code every run; report ✅ Holds or ⚠️ Violated._

### Still open

| ID | Pri | Issue | Lean recommendation |
| --- | --- | --- | --- |

_Required queue. Code-check every run; report Still open / Fixed / Obsolete._

### Regression watchlist

| ID | Risk if re-broken | Quick check |
| --- | --- | --- |
| P2-1 | Subscription upsert webhook path breaks | `isSubscriptionUpsertEvent` + `upsertSubscriptionStateFromObject` in persist |
| P2-2 | Webhook/checkout cannot resolve app user | `resolveAppUserIdForSubscription` in subscription-state |
| P4-1 | Stripe Dashboard still subscribed to removed event | `npm run stripe:validate-webhooks` after deploy |
| P2-5 | Account delete leaves Stripe billing active | `teardownStripeBillingForUser` in profile delete path |
| P4-2 | Build fails loading next.config | `validate-billing-env.ts` → `../lib/infra/logger` |

_Run **Quick check** in code every run; report ✅ Pass or ⚠️ Regression. Prior pass does not carry forward._

---

## History

### Run #5 · 2026-06-09 (fixes applied)
**Stats:** P5-5 fixed · ESLint pass · 530 tests pass · build pass  
**Fixes applied:** all approved IDs (`all`)  
**New findings:** none remaining  
**Delta:** Still open cleared → Implemented

### Run #5 · 2026-06-09 (report)
**Stats:** 285 scoped files · src +1050 −5459 (net −4409) · ESLint pass · 530 tests pass · build pass  
**Fixes applied:** none (report-only)  
**New findings:** P5-5 (Minor)  
**Delta:** all Implemented/Accepted/Watchlist hold

### Run #4 · 2026-06-09 (fixes applied)
**Stats:** P4-2, P1-2, P5-4 fixed · ESLint pass · 530 tests pass · build pass  
**Fixes applied:** all approved IDs (`all`)  
**New findings:** none remaining  
**Delta:** Still open cleared → Implemented

### Run #4 · 2026-06-09 (report)
**Stats:** 282 scoped files · build fails before fixes  
**New findings:** P4-2, P1-2 (Major); P2-8, P5-4 (Minor)

### Run #3 · 2026-06-09 (fixes applied)
**Stats:** P2-7, P5-2, P5-3 fixed · 530 tests pass

### Run #3 · 2026-06-09 (report)
**Stats:** 219 scoped files · P2-7, P5-2, P5-3 new (Minor)

### Run #2 · 2026-06-09
**Stats:** all approved audit IDs fixed

### Run #1 · 2026-06-09
**Stats:** first run · 143 scoped files
