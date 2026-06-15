# Neon + Vercel Resource Optimization Spec

## Goal

Maximize efficiency of Neon compute and Vercel resource consumption. The app is well within free-tier limits today, but every optimization compounds: lower latency, lower cold-start risk, and headroom for growth without hitting quota walls.

**Vercel baseline (last 30 days)**

| Metric | Used | Limit |
|---|---|---|
| Fluid Active CPU | 10m 29s | 4h |
| Function Invocations | 7.7K | 1M |
| ISR Reads | 359 | 1M |
| ISR Writes | 14 | 200K |
| Fast Data Transfer | 94.66 MB | 100 GB |
| Fluid Provisioned Memory | 0.70 GB-Hrs | 360 GB-Hrs |

**Neon baseline (since Jun 1)**

| Metric | Value | Plan |
|---|---|---|
| Compute | 1.25 CU-hrs | 2 CU max |
| Storage | 33.1 MB | 0.5 GB |
| Network | 655 KB | 5 GB public |
| Scale to zero | After 5 min | — |

---

## Summary Table — All Findings by Criticality

| ID | Finding | Category | Criticality |
|---|---|---|---|
| F1 | Prisma schema missing `url` + `directUrl` — migrations run against pooler | Schema & Connection | **CRITICAL** |
| F3 | N+1 in all 4 paginated list views — `fetchItemPreviews` second round trip | Query Efficiency | **HIGH** |
| F4 | Missing compound indexes: `(userId, isPinned)`, `(userId, isFavorite)`, `(userId, itemTypeId)` on Item | Schema & Connection | **HIGH** |
| F5 | `canCreateItem` called twice per dashboard render (layout + page) with no caching | Query Efficiency | **HIGH** |
| F2 | `getUserSessionInfo` not wrapped in `React.cache()` — no per-request dedup safety net | Auth & Session | **HIGH** |
| F6 | `revalidatePath` over-firing — 7 redundant ISR invalidation calls on every item/collection mutation | Caching Layer | **MEDIUM** |
| F3b | N+1 in `globalSearch` — same `fetchItemPreviews` pattern as list views | Query Efficiency | **MEDIUM** |
| F7 | `JSON.parse(JSON.stringify())` in `withDataCache` serializer — slow, loses `Date` type fidelity | Caching Layer | **LOW** |
| F5b | `canCreateCollection` uncached in `createCollectionAction` — 1 raw COUNT per free-user create | Query Efficiency | **LOW** |
| Fa | Missing `(userId, isFavorite)` index on Collection model | Schema & Connection | **LOW** |
| F9 | `unstable_cache` → `use cache` directive migration | Caching Layer | **DEFERRED** |

**Verified good — no action needed:**

| Area | Status |
|---|---|
| Middleware (`proxy.ts`) — edge-safe `authConfig`, no DB calls | ✓ Optimal |
| `fetchSidebarData` — wrapped in `React.cache()`, deduped per request | ✓ Optimal |
| `getProfileData` — wrapped in `withDataCache`, cached per-user | ✓ Optimal |
| `withDataCache` request cache — React.cache layer correctly deduplicates within a render | ✓ Optimal |
| `staleTimes: { dynamic: 30, static: 180 }` — configured in `next.config.ts` | ✓ Optimal |
| `serverExternalPackages` — Prisma/Neon/S3 excluded from bundle | ✓ Optimal |
| `unstable_cache(revalidate: false)` — on-demand only, no time-based ISR writes | ✓ Optimal |
| Redis/Upstash — lazy init, fails open on unavailability | ✓ Optimal |
| `canCreateCollection` in layout — derived from sidebar data count, no extra DB call | ✓ Optimal |
| `DashboardStats` + `DashboardPage` both call `getItemStats` — deduped by request cache | ✓ Optimal |
| JWT strategy — avoids DB session table lookups on every request | ✓ Optimal |

---

## Codebase Audit — Findings by Category

---

### Category A — Database Schema & Connection

#### F1 — Prisma schema missing `url` + `directUrl` [CRITICAL]

**File**: `prisma/schema.prisma:7`

```prisma
datasource db {
  provider   = "postgresql"
  extensions = [pg_trgm]
  // ← no url, no directUrl — relies on Prisma defaults
}
```

`.env.example` documents `DATABASE_URL` as the **pooled** Neon URL (`-pooler` suffix, PgBouncer in transaction mode) and `DIRECT_URL` as the direct connection URL. `prisma/seed.ts` correctly uses `DIRECT_URL` at runtime. But the schema never passes `DIRECT_URL` to Prisma CLI.

**Impact**: Prisma CLI (migrations, introspection, studio) uses `DATABASE_URL` — the pooler. Neon's pooler runs PgBouncer in **transaction mode** which cannot handle DDL that requires session-level state (`CREATE INDEX CONCURRENTLY`, advisory locks, `SET` commands). Migrations may fail silently, leave partial state, or produce incorrect results under load. This is a correctness bug, not just a performance issue.

**Fix**:
```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [pg_trgm]
}
```
Prisma CLI will use `DIRECT_URL` for migrations; the PrismaNeon adapter in `src/lib/prisma.ts` continues to use `DATABASE_URL` (the pooler) for all runtime queries. No migration needed — config-only change. Run `prisma migrate status` after to verify sync.

---

#### F4 — Missing compound indexes on Item model [HIGH]

**File**: `prisma/schema.prisma:129`

Current indexes on `Item`:
```prisma
@@index([itemTypeId])
@@index([userId, createdAt])
@@index([title(ops: raw("gin_trgm_ops"))], type: Gin)
@@index([description(ops: raw("gin_trgm_ops"))], type: Gin)
@@index([content(ops: raw("gin_trgm_ops"))], type: Gin)
```

**Gaps**:

| Missing index | Query that needs it | Current behavior |
|---|---|---|
| `(userId, isPinned, updatedAt)` | `getPinnedItems`: `WHERE userId AND isPinned=true ORDER BY updatedAt DESC` | Falls back to `(userId, createdAt)` index — post-filter on isPinned |
| `(userId, isFavorite, updatedAt)` | `getFavoriteItemsPage`: `WHERE userId AND isFavorite=true ORDER BY updatedAt DESC` | Seq scan with filter |
| `(userId, itemTypeId)` | `getSidebarItemTypes` groupBy, `getItemsByTypePage` filter | Single-column `[itemTypeId]` bypasses the user scope entirely |

At current scale (~hundreds of items/user) this is unnoticeable. At thousands of items/user these become O(n) scans with filter. Add now before they become a bottleneck.

**Fix**: Add to `Item` model in `prisma/schema.prisma`:
```prisma
@@index([userId, isPinned, updatedAt])
@@index([userId, isFavorite, updatedAt])
@@index([userId, itemTypeId])
```
Run: `prisma migrate dev --name add-compound-indexes`

---

#### Fa — Missing `(userId, isFavorite)` index on Collection model [LOW]

**File**: `prisma/schema.prisma:176`

Current indexes on `Collection`:
```prisma
@@index([userId, updatedAt])
@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)
@@index([description(ops: raw("gin_trgm_ops"))], type: Gin)
```

`getFavoriteCollections` queries `WHERE userId AND isFavorite=true ORDER BY updatedAt DESC`. The current `(userId, updatedAt)` index covers the userId scope and ordering but still requires a post-filter on `isFavorite`. With a small collection count per user, this is negligible today.

**Fix**: Add to `Collection` model (can be bundled with the Item migration above):
```prisma
@@index([userId, isFavorite, updatedAt])
```

---

### Category B — Query Efficiency / N+1

#### F3 — N+1 in all 4 paginated list views [HIGH]

**File**: `src/lib/db/items.ts:294` (`getPaginatedItems`) and `src/lib/db/items.ts:309`

Every paginated list fires **2 Neon round trips**:
1. `prisma.item.findMany(LIGHT_ITEM_SELECT)` — LIGHT_ITEM_SELECT has no `content` or `description` fields
2. `fetchItemPreviews(ids)` — raw SQL `SELECT id, LEFT(content, 150), LEFT(description, 150) FROM items WHERE id IN (...)`

```ts
// items.ts:303–315
const rows = c
  ? await prisma.item.findMany({ ...query, skip: 1, cursor: { id: c } })
  : await prisma.item.findMany(query)                    // round trip 1: no description/content
const hasMore = rows.length > ITEMS_PAGE_SIZE
const page = rows.slice(0, ITEMS_PAGE_SIZE)
const previews = await fetchItemPreviews(page.map((r) => r.id))  // round trip 2
```

Affected list views: Recent Items, Items by Type, Items by Collection, Favorites — **all 4**.

`getPinnedItems` (line 99) already solves this correctly:
```ts
select: { ...LIGHT_ITEM_SELECT, description: true }
// then slices in the map: description ? description.slice(0, 150) : null
```

**Fix**: Extend `LIGHT_ITEM_SELECT` to include `description: true, content: true`. Derive previews in `toLightItem` by slicing instead of a second query. Remove `fetchItemPreviews` call from `getPaginatedItems`. Verify no other callers remain before removing the export.

Effect: **cuts Neon round trips for list views by 50%**.

---

#### F3b — N+1 in `globalSearch` [MEDIUM]

**File**: `src/lib/db/search.ts:36`

`globalSearch` shares the same N+1 pattern as list views:
```ts
const [itemRows, collectionRows] = await Promise.all([
  prisma.item.findMany({ where: {...}, select: LIGHT_ITEM_SELECT, take: 20 }), // round trip 1: no description/content
  prisma.collection.findMany({ ... }),
])
const previews = await fetchItemPreviews(itemRows.map((r) => r.id))  // round trip 2
```

**Fix**: Once `LIGHT_ITEM_SELECT` is extended (see F3 fix), import the updated select in `search.ts`. Remove `fetchItemPreviews` from `globalSearch` and derive previews inline from the already-fetched `description`/`content` fields. This fix is a direct consequence of F3 — no additional schema changes needed.

---

#### F5 — `canCreateItem` called twice per dashboard render, uncached [HIGH]

**File**: `src/app/(app)/layout.tsx:48` and `src/app/(app)/dashboard/page.tsx:30`

Both files independently call `canCreateItem(userId, isPro)` which calls `countItemsByUserId` which calls `prisma.item.count({ where: { userId } })` — an uncached DB query.

```ts
// layout.tsx:44–50 (runs on EVERY protected page navigation)
const [profileData, userCanCreateItem] = await Promise.all([
  getProfileData(userId).catch(() => null),
  canCreateItem(userId, isPro),    // ← COUNT query #1 (free users only)
])

// dashboard/page.tsx:26–32 (runs ADDITIONALLY on dashboard)
const [firstPage, itemStats, ..., userCanCreateItem, ...] = await Promise.all([
  ...
  canCreateItem(userId, user.isPro), // ← COUNT query #2 (free users only)
  ...
])
```

On a dashboard navigation, free users fire **2 uncached COUNT queries** from two separate render contexts (layout and page are separate RSC invocations that don't share React.cache state).

The fix also applies to `createItemAction` (`src/actions/items.ts:70`) which fires a third uncached COUNT on every item create attempt.

**Fix — Option A (wrap with `withDataCache`)**: Wrap `countItemsByUserId` with `withDataCache` using `CacheTags.itemStats(userId)` so the count is cached and auto-invalidated on item mutations. Both layout and page calls hit the Data Cache after the first invocation.

**Fix — Option B (derive from cached `getItemStats`)**: `getItemStats(userId)` already returns `totalItems` and is cached. Pass `itemStats.totalItems < FREE_TIER_ITEM_LIMIT` instead of calling `canCreateItem` separately in the dashboard page. For layout and for `createItemAction`, Option A (cache the count) is still needed.

Prefer Option B for `dashboard/page.tsx`, Option A for `layout.tsx` and `createItemAction`.

---

#### F5b — `canCreateCollection` uncached in `createCollectionAction` [LOW]

**File**: `src/actions/collections.ts:25` → `src/lib/usage.ts:14`

`canCreateCollection` fires `prisma.collection.count({ where: { userId } })` on every collection create attempt for free users. Unlike `canCreateItem`, it is NOT called in the layout (the layout derives collection gating from sidebar data — already correct). Impact is limited to create-time only. Cache with `withDataCache` using `CacheTags.collectionStats(userId)` for consistency.

---

### Category C — Auth & Session

#### F2 — `getUserSessionInfo` not wrapped in `React.cache()` [HIGH]

**File**: `src/lib/db/users.ts:6` → called from `src/auth.ts:119` (JWT callback)

```ts
// users.ts:6 — called on every JWT verification
export async function getUserSessionInfo(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, password: true, isPro: true } })
}
```

**Why it exists**: Password-rotation detection — every JWT verification compares `token.pwHash` against the live DB fingerprint.

**NextAuth v5 context**: NextAuth v5's `auth()` function is internally wrapped in `React.cache()`, so multiple `auth()` calls within the same RSC render tree are deduplicated at the NextAuth level. The layout's second `getSession()` call on line 40 (marked "deduped by NextAuth's request-level memoization") is correctly handled.

**Remaining gap**: `React.cache()` is request-scoped within an RSC render tree. However:
1. If `getUserSessionInfo` is ever called directly (outside the `auth()` path), it gets no deduplication.
2. Server actions run in a separate invocation context — any `auth()` call inside a server action triggers a fresh JWT callback → `getUserSessionInfo` DB hit, separate from the render-tree call.
3. The `React.cache()` wrap on `getUserSessionInfo` acts as a safety net that ensures deduplication regardless of the call path.

With 7.7K function invocations/month, auth DB queries are a meaningful fraction of total Neon compute. Wrapping `getUserSessionInfo` in `React.cache()` eliminates redundant hits within any invocation where it's called more than once.

**Fix**:
```ts
// src/lib/db/users.ts
import { cache } from 'react'

export const getUserSessionInfo = cache(async (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, password: true, isPro: true },
  })
})
```

---

### Category D — Caching Layer

#### F6 — `revalidatePath` over-firing on every item/collection mutation [MEDIUM]

**File**: `src/lib/cache.ts:82–109`

`invalidateItemsCache` (called on every item create/update/delete/toggle):
```ts
revalidateTag(`items-${userId}`)       // ← sweeps all item data caches ✓
revalidatePath('/dashboard')           // ← ISR invalidation (no-op + overhead)
revalidatePath('/items')               // ← ISR invalidation (no-op + overhead)
revalidatePath('/collections', 'layout') // ← ISR invalidation (no-op + overhead)
revalidatePath('/favorites')           // ← ISR invalidation (no-op + overhead)
```

`invalidateCollectionsCache` fires 3 additional `revalidatePath` calls: `/dashboard`, `/collections` layout, `/favorites`.

**Why they're redundant**: All protected pages call `auth()` → they are dynamically rendered — the CDN never caches their HTML. `revalidatePath` on a fully dynamic page triggers an internal Vercel invalidation request but has no effect on cache state. The `revalidateTag` sweep is fully sufficient to keep the Next.js Data Cache fresh.

These 7 redundant calls per typical mutation (4 from items + 3 from collections on collection ops) account for the majority of the 14 ISR Writes observed in the baseline.

**Fix**: Remove from `invalidateItemsCache`:
```ts
// DELETE:
revalidatePath('/dashboard')
revalidatePath('/items')
revalidatePath('/collections', 'layout')
revalidatePath('/favorites')
```
Remove from `invalidateCollectionsCache`:
```ts
// DELETE:
revalidatePath('/dashboard')
revalidatePath('/collections', 'layout')
revalidatePath('/favorites')
```
Keep: `invalidateProfileCache`'s `revalidatePath('/profile', 'page')` — profile page may benefit from page-level cache in future and is not dynamically rendered by default.

---

#### F7 — `JSON.parse(JSON.stringify())` in cache serializer [LOW]

**File**: `src/lib/cache.ts:66`

```ts
return JSON.parse(JSON.stringify(result)) as T
```

Used to strip Prisma proxy objects before storing in `unstable_cache`. Problems:
- **Performance**: Full serialize+parse of the object graph on every cache miss (e.g., a 20-item list with all select fields)
- **Type fidelity**: `Date` objects become ISO strings — callers receive `string` where `Date` is expected. Prisma returns `Date` for `createdAt`/`updatedAt`; after this round-trip the type annotation lies.
- **Correctness risk**: Any code that checks `instanceof Date` will fail silently on cached results

**Fix**: `structuredClone(result)` — native V8 deep clone, ~2× faster than JSON round-trip, correctly handles `Date`, `null` vs `undefined`, `BigInt`, and other non-JSON-serializable types:
```ts
return structuredClone(result) as T
```

Note: `structuredClone` cannot clone Prisma's internal `Decimal` type. If `Decimal` fields are ever added to the schema, handle them before cloning (convert to `string` or `number`). Current schema has no `Decimal` fields.

---

#### F9 — `unstable_cache` → `use cache` directive [DEFERRED]

Next.js 16.2.7 ships the `use cache` directive with `cacheLife`/`cacheTag`. Replaces `unstable_cache` with better RSC integration, automatic cache key derivation, and partial page caching support.

**Decision**: Defer. `unstable_cache` is stable and works correctly. Migrate only if:
- `use cache` API is documented stable in Next.js 16 (currently marked experimental)
- Partial page caching provides a concrete measured benefit
- `withDataCache` abstraction needs to change for another reason

---

### Category E — Vercel Function Lifecycle (verified good)

- **`staleTimes: { dynamic: 30, static: 180 }`** (`next.config.ts:15`): Router Cache holds dynamic page data for 30s — navigating back within 30s skips a function invocation. Already optimal.
- **`serverExternalPackages`** (`next.config.ts:7`): `@prisma/client`, `@prisma/adapter-neon`, `@neondatabase/serverless`, `@aws-sdk/client-s3` are excluded from the serverless bundle. Without this, Webpack would attempt to bundle them and fail or produce oversized functions.
- **`unstable_cache(revalidate: false)`**: All item/collection caches use on-demand invalidation only — no time-based revalidation = zero background ISR writes.

---

### Category F — Middleware & Edge (verified good)

**File**: `src/proxy.ts`

Middleware uses `authConfig` from `src/auth.config.ts` — the edge-safe config that uses JWT-only session verification with no Prisma/bcrypt imports. This means:
- Route protection is evaluated at the Vercel Edge (no cold start, no Neon connection)
- No DB call happens until the request hits a server component or API route

Matcher correctly excludes `api`, `_next/static`, `_next/image`, `favicon.ico` to prevent unnecessary middleware invocations on static assets.

---

### Category G — External Services (verified good)

**Upstash Redis** (`src/lib/redis.ts`, `src/lib/rate-limit.ts`):
- Lazily initialized — missing env vars don't crash at import
- Fails open on unavailability — requests proceed when Redis is down
- Sliding window rate limiting with appropriate per-action thresholds
- Used only for rate limiting, not application caching — correct separation

**AWS S3** (`src/lib/storage/s3.ts`): File uploads are Pro-only, handled server-side. `@aws-sdk/client-s3` is in `serverExternalPackages` — correct.

**Note for AI feature** (planned in `docs/ai-integration-plan.md`): The `aiRequest` rate limit key documented in the AI plan is not yet added to `src/lib/rate-limit.ts`. Required before shipping AI features.

---

## Implementation Plan

### Phase 1 — Schema & Connection (zero behavior change, highest safety)

**1a — Add `url` + `directUrl` to datasource** (`prisma/schema.prisma`):
```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [pg_trgm]
}
```
Run `prisma migrate status` — expect "Database schema is up to date".

**1b — Add compound indexes** (`prisma/schema.prisma` — Item model):
```prisma
@@index([userId, isPinned, updatedAt])
@@index([userId, isFavorite, updatedAt])
@@index([userId, itemTypeId])
```
Optional: add to Collection model:
```prisma
@@index([userId, isFavorite, updatedAt])
```
Run: `prisma migrate dev --name add-compound-indexes`

---

### Phase 2 — Eliminate N+1 in list views and search

**File**: `src/lib/db/items.ts`

1. Add `description: true, content: true` to `LIGHT_ITEM_SELECT`
2. Update `LightItemWithRelations` type (inferred from `LIGHT_ITEM_SELECT`, will update automatically)
3. Update `toLightItem` to derive previews from raw fields:
   ```ts
   descriptionPreview: item.description ? item.description.slice(0, 150) : null,
   contentPreview: item.content ? item.content.slice(0, 150) : null,
   ```
4. Remove `fetchItemPreviews` call from `getPaginatedItems`
5. Update `src/lib/db/search.ts` — remove `fetchItemPreviews` import and call; derive previews from already-fetched fields
6. If `fetchItemPreviews` has no remaining callers, remove its export (check `items.test.ts` — update affected tests)

Effect: **4 list views + search go from 2 Neon round trips to 1**.

---

### Phase 3 — Caching: `canCreateItem` + `getUserSessionInfo`

**3a — Wrap `getUserSessionInfo` in `React.cache()`** (`src/lib/db/users.ts`):
```ts
import { cache } from 'react'

export const getUserSessionInfo = cache(async (id: string) => {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, password: true, isPro: true },
  })
})
```

**3b — Cache `canCreateItem`** (`src/lib/usage.ts`):

Option A — wrap `countItemsByUserId` with `withDataCache`:
```ts
// src/lib/db/usage.ts
export async function countItemsByUserId(userId: string): Promise<number> {
  return withDataCache(
    CacheTags.itemStats(userId),   // already invalidated on item mutations
    () => prisma.item.count({ where: { userId } })
  )
}
```

Option B — in `dashboard/page.tsx`, derive from already-cached `itemStats.totalItems`:
```ts
// Remove canCreateItem from the Promise.all
// Derive from itemStats:
const userCanCreateItem = user.isPro || itemStats.totalItems < FREE_TIER_ITEM_LIMIT
```
Prefer Option B for the dashboard page. Option A covers `layout.tsx` and `createItemAction`.

---

### Phase 4 — Cache cleanup

**4a — Remove dead `revalidatePath` calls** (`src/lib/cache.ts`):
- Remove 4 calls from `invalidateItemsCache`: `/dashboard`, `/items`, `/collections` layout, `/favorites`
- Remove 3 calls from `invalidateCollectionsCache`: `/dashboard`, `/collections` layout, `/favorites`
- Keep `invalidateProfileCache`'s `revalidatePath('/profile', 'page')`

**4b — Replace cache serializer** (`src/lib/cache.ts:66`):
```ts
// Before:
return JSON.parse(JSON.stringify(result)) as T
// After:
return structuredClone(result) as T
```

---

## Acceptance Criteria

- [ ] `prisma/schema.prisma` datasource has `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`
- [ ] `prisma migrate status` shows all migrations in sync after schema changes
- [ ] Three compound indexes added to Item model; one to Collection model (optional)
- [ ] All 4 list views fire a single Neon query per page (no `fetchItemPreviews` second round trip)
- [ ] `globalSearch` fires 2 queries (items + collections), not 3
- [ ] `getUserSessionInfo` wrapped in `React.cache()`
- [ ] `canCreateItem` result is cached — dashboard load fires at most 1 COUNT query per user (not 2)
- [ ] `revalidatePath` calls removed from `invalidateItemsCache` and `invalidateCollectionsCache`
- [ ] `structuredClone` replaces `JSON.parse(JSON.stringify())` in `withDataCache`
- [ ] `npm run build && npm run test:run` passes with no errors
- [ ] Verify: Neon compute CU-hrs trend flat or down after deploy
- [ ] Verify: Vercel ISR Writes drop significantly (from 14 toward 0) after removing `revalidatePath`

---

## Files Touched

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `url`, `directUrl`; 3 new Item indexes; 1 new Collection index |
| `src/lib/db/items.ts` | Extend `LIGHT_ITEM_SELECT` with description/content; remove N+1 second query |
| `src/lib/db/search.ts` | Remove `fetchItemPreviews`; derive previews from extended select |
| `src/lib/db/users.ts` | Wrap `getUserSessionInfo` with `React.cache()` |
| `src/lib/db/usage.ts` | Wrap `countItemsByUserId` with `withDataCache` |
| `src/lib/cache.ts` | Remove `revalidatePath` calls; replace `JSON.parse(JSON.stringify())` |
| `src/app/(app)/dashboard/page.tsx` | Derive `canCreate` from cached `itemStats.totalItems` (Phase 3, Option B) |

No new dependencies. Schema changes: indexes only + directUrl config.
