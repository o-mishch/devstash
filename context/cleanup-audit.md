# Cleanup Improve Audit

> Prior-run notebook for `/cleanup improve`. **Every table row challenged each run** — never passed as ignored. **History** = append only.

**Last run:** #6 · 2026-06-09 · 83 files · LOC src +625 −469 (net +156) → fixes applied

## Next-run context

AI descriptions/tags + image thumbnails + AppUser context changeset. Run #6 fixes applied for all audit IDs (P2-8 through P2-12, P5-6). Shared AI test helpers, `AiTagsField`, unified image probing, deduplicated `getFileExtension`, inlined stream helper, layout uses `canCreateCollection()`. Prior billing audit items still hold.

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
| P2-8 | Shared AI action test mocks | Duplicate setup in description + tag tests | `ai-action-test-helpers.ts` | both test files import `setupProAiMocks` |
| P2-9 | Inlined stream helper | Single-use `stream-response.ts` | `download/[id]/route.ts` | no `stream-response.ts` |
| P2-10 | Shared `getFileExtension` | Duplicated in item-context + image-thumbnails | `lib/utils/files.ts` | both modules import from files |
| P2-11 | Layout uses `canCreateCollection()` | Inline sidebar count vs db helper | `layout.tsx` | `canCreateCollection(userId, isPro)` in Promise.all |
| P2-12 | Extracted `AiTagsField` | AutoTagInput duplicated AI chrome | `ai-tags-field.tsx`, `auto-tag-input.tsx` | tags field uses shared wrapper |
| P5-6 | Unified image dimension probing | createImageBitmap vs Image() split | `image-dimensions.client.ts`, `use-probed-image-dimensions.ts` | file-upload + hook share utils |

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
| P2-8 | AI action tests drift on mock setup | `setupProAiMocks` in `ai-action-test-helpers.ts` |
| P2-11 | Collection create gated by stale sidebar count | `canCreateCollection(userId, isPro)` in layout |
| P2-12 | Tag AI chrome diverges from description field | `AiTagsField` shared wrapper |
| P5-6 | Image dimensions probe implementations diverge | `image-dimensions.client.ts` + `use-probed-image-dimensions.ts` |

_Run **Quick check** in code every run; report ✅ Pass or ⚠️ Regression. Prior pass does not carry forward._

---

## History

### Run #6 · 2026-06-09 (fixes applied)
**Stats:** all approved IDs fixed · ESLint pass · 59 affected tests pass  
**Fixes applied:** P2-8, P2-9, P2-10, P2-11, P2-12, P5-6 (`all`)  
**New findings:** none remaining  
**Delta:** Still open cleared → Implemented

### Run #6 · 2026-06-09 (report)
**Stats:** 83 scoped files · src +625 −469 (net +156) · ESLint pass · 6 new findings (Minor)  
**Fixes applied:** none (report-only)  
**New findings:** P2-8, P2-9, P2-10, P2-11, P2-12, P5-6  
**Delta:** all Implemented/Accepted/Watchlist hold · net LOC creep +156

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
