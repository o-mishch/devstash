# Cleanup Improve Audit

> Prior-run notebook for `/cleanup improve`. **Every table row challenged each run** — never passed as ignored. **History** = append only.

**Last run:** #2 · 2026-06-10 · 11 uncommitted files · LOC src +99 −56 (pre-fixes)

## Next-run context

Follow-up slice on the traffic-volume feature: collection cache correctness after item mutations, dashboard `getCollectionsPreview` (DB-level limit + dedicated cache tag), DRY `fetchCollectionsWithTypes` for list reads, SQL-side top-4 type ranking, sidebar `dominantColor`, and slimmer `CollectionPickerItem` props in the item drawer. Run #2 fixes: merged constants import (P5-1), reverted search map wrapper (P2-5), collection cache invalidation tests (P5-2).

### Implemented (prior fixes — challenge in code each run)

| ID | What was done | Why | Key files | Verify |
| --- | --- | --- | --- | --- |
| P2-1 | Inlined `isPreviewRequest` at both call sites | Eliminate identical 3-line helper across two routes | `download/[id]/route.ts`, `download/[id]/url/route.ts` | No `isPreviewRequest` function in either file |
| P2-2 | Extracted `groupTypeCountsByCollection()` helper; used in `getAllCollections` + `getFavoriteCollections` | Remove 8-line duplicate body | `src/lib/db/collections.ts` | Single `groupTypeCountsByCollection` definition; both callers use it (via `fetchCollectionsWithTypes`) |
| P2-3 | Moved `SignedDownloadUrlResponse` to `src/types/item.ts`; imported in route + hook | Single source of truth for API response shape | `src/types/item.ts`, `url/route.ts`, `use-pro-download-src.ts` | No local `interface SignedDownloadUrlResponse` in either file |
| P5-1 | Merged two `@/lib/utils/constants` import lines into one | Hygiene (re-applied run #2) | `src/components/items/item-create-dialog.tsx` | One import line from `@/lib/utils/constants` |
| P2-5 | Reverted `(col) => mapSidebarCollection(col)` to `.map(mapSidebarCollection)` | Remove pointless wrapper | `src/lib/db/search.ts` | Direct function reference in `.map()` |
| P5-2 | Asserted `invalidateCollectionsCache` on create-with-collections, update, delete | Cover new item→collection cache invalidation | `src/actions/items.test.ts` | Four expectations on success paths |

### Accepted tradeoffs (user decided — challenge still applies)

_First run — no accepted tradeoffs._

### Still open

_All findings fixed._

### Regression watchlist

| ID | Risk if re-broken | Quick check |
| --- | --- | --- |
| P2-1 | Two routes diverge silently | Grep for `isPreviewRequest` — should return 0 results in `src/` |
| P2-2 | Duplicate body re-introduced | `groupTypeCountsByCollection` called from `fetchCollectionsWithTypes` (used by `getAllCollections` + `getFavoriteCollections`) |
| P2-3 | Interface re-declared locally | No local `interface SignedDownloadUrlResponse` in route or hook |
| P5-1 | Duplicate constants import lines return | One import line from `@/lib/utils/constants` in `item-create-dialog.tsx` |
| P2-5 | Pointless map wrapper returns | `collectionRows.map(mapSidebarCollection)` in `search.ts` |
| P5-2 | Collection cache invalidation untested | `items.test.ts` asserts `invalidateCollectionsCache` on create/update/delete |

---

## History

### Run #2 · 2026-06-10
**Stats:** 11 files · **Fixes applied:** P5-1, P2-5, P5-2 · **New findings:** 3 (all Minor, all fixed)
**Delta:** P2-1/2/3 hold · P5-1 regressed then re-fixed · est. net −2 LOC from hygiene
**Notes:** No Major issues. Collection cache invalidation now tested.

### Run #1 · 2026-06-10
**Stats:** 70 files · LOC src +1107 −693 (net +414) · **Fixes applied:** P2-1, P2-2, P2-3, P5-1 · **New findings:** 4 (all Minor)
**Delta:** first run — no prior audit
**Notes:** All findings Minor. No Major bugs, security issues, API violations, or regressions. Changeset is architecturally clean. Est. −24 LOC recovered.
