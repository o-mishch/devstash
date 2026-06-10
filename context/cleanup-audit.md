# Cleanup Improve Audit

> Prior-run notebook for `/cleanup improve`. **Every table row challenged each run** — never passed as ignored. **History** = append only.

**Last run:** #1 · 2026-06-10 · 70 uncommitted files · LOC src +1107 −693

## Next-run context

Traffic-volume optimization feature (phases 4a–4f). The changeset delivers: presigned direct upload (browser thumb + dimensions), signed download URL route + client cache with in-flight dedup, copy-link 302 redirect, service worker image byte cache, slim selects across lists/mutations/collections, deferred drawer content, N+1 removal, and all supporting DB/storage plumbing. Net +414 LOC in `src/` across 62 files.

### Implemented (prior fixes — challenge in code each run)

_First run — no prior fixes._

### Accepted tradeoffs (user decided — challenge still applies)

_First run — no accepted tradeoffs._

### Still open

_All findings fixed._

### Implemented (prior fixes — challenge in code each run)

| ID | What was done | Why | Key files | Verify |
| --- | --- | --- | --- | --- |
| P2-1 | Inlined `isPreviewRequest` at both call sites | Eliminate identical 3-line helper across two routes | `download/[id]/route.ts`, `download/[id]/url/route.ts` | No `isPreviewRequest` function in either file |
| P2-2 | Extracted `groupTypeCountsByCollection()` helper; used in `getAllCollections` + `getFavoriteCollections` | Remove 8-line duplicate body | `src/lib/db/collections.ts` | Single `groupTypeCountsByCollection` definition; both callers use it |
| P2-3 | Moved `SignedDownloadUrlResponse` to `src/types/item.ts`; imported in route + hook | Single source of truth for API response shape | `src/types/item.ts`, `url/route.ts`, `use-pro-download-src.ts` | No local `interface SignedDownloadUrlResponse` in either file |
| P5-1 | Merged two `@/lib/utils/constants` import lines into one | Hygiene | `src/components/items/item-create-dialog.tsx` | One import line from `@/lib/utils/constants` |

### Regression watchlist

| ID | Risk if re-broken | Quick check |
| --- | --- | --- |
| P2-1 | Two routes diverge silently | Grep for `isPreviewRequest` — should return 0 results in `src/` |
| P2-2 | Duplicate body re-introduced | `groupTypeCountsByCollection` called in both `getAllCollections` and `getFavoriteCollections` |
| P2-3 | Interface re-declared locally | No local `interface SignedDownloadUrlResponse` in route or hook |

---

## History

### Run #1 · 2026-06-10
**Stats:** 70 files · LOC src +1107 −693 (net +414) · **Fixes applied:** P2-1, P2-2, P2-3, P5-1 · **New findings:** 4 (all Minor)
**Delta:** first run — no prior audit
**Notes:** All findings Minor. No Major bugs, security issues, API violations, or regressions. Changeset is architecturally clean. Est. −24 LOC recovered.
