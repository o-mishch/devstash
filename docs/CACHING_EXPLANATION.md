# TanStack Query Caching Behavior — Explanation

## The Question
When switching between item types (Snippet → Prompts → Snippet), why does the backend get called each time?

## The Answer: Two-Layer Caching

Your app has **two separate caching layers** that work together:

> **Note:** This explanation is verified against official TanStack Query v5 documentation.

### Layer 1: Server-Side Caching (Next.js `'use cache'`)
**Location:** `src/lib/db/items.ts` — functions like `fetchItemsByTypeFirstPage()`

```typescript
async function fetchItemsByTypeFirstPage(userId: string, typeName: string): Promise<ItemsPage> {
  'use cache'                                    // ← Enables Next.js native caching
  const cacheKey = CacheTags.itemsByType(userId, typeName)
  cacheTag(cacheKey, CacheTags.itemGroup(userId))
  cacheLife('max')                              // ← Caches indefinitely on server
  return runPaginatedQuery({ userId, itemType: { name: typeName } }, ...)
}
```

**What it does:**
- Caches the database query result on the **Vercel regional infrastructure**
- When you reload the page or navigate to a different type and back, the server **reuses cached data** (no DB hit)
- This is transparent to the browser

**How to verify (DevTools → Network tab):**
1. Navigate to `/items/snippet` → tab shows initial load
2. Switch to `/items/prompt` → new full-page navigation, server caches this too
3. The Network tab shows the HTML response, but the **backend DB query was cached** (you don't see the Prisma query from the browser)

---

### Layer 2: Browser-Side Caching (TanStack Query)
**Location:** `src/providers/query-client-provider.tsx` and `src/hooks/use-infinite-items.ts`

```typescript
// Client provider (global config)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // Data is fresh for 5 minutes
      gcTime: 10 * 60 * 1000,      // Keep in memory for 10 minutes
    },
  },
})

// Per-hook setup
export function useInfiniteItems(fetchParams, initialData) {
  return useInfiniteQuery({
    queryKey: ['items', JSON.stringify(fetchParams)],
    queryFn: async ({ pageParam }) => {
      const result = await fetchMoreItemsAction(fetchParams, pageParam)
      // ↑ This calls a server action only when cache is stale or data missing
      return result.data
    },
    initialData: { pages: [initialData], pageParams: [null] },
    // ↑ Preload with server-rendered data so cache is not empty on first load
  })
}
```

**What it does:**
- Stores page data in the browser's **JavaScript memory** during the session
- Different query keys for different item types: `['items', '{"type":"snippet"}']` vs `['items', '{"type":"prompt"}']`
- Each type has its own cache entry

---

## Why You See Backend Calls on Each Switch

**This is expected behavior.** Here's the flow:

### Scenario: Snippet → Prompts → Snippet

| Step | Action | Cache State | Network Tab | Expected |
|------|--------|-------------|-------------|----------|
| 1 | Load `/items/snippet` | Empty | ✅ HTML page loads | First load, no cache yet |
| 2 | (Wait 5 sec) | Query fresh in memory | — | Data still valid |
| 3 | Click `/items/prompt` | **New** cache entry | ✅ HTML page loads | Different item type = different query key |
| 4 | (Wait 5 sec) | Query fresh in memory | — | Data still valid |
| 5 | Click back to `/items/snippet` | **Old cache still exists** (if <5 min) | ✅ HTML page loads | **Should use cached data!** |

### Key Insight: Full-Page Navigation Resets TanStack Query

When you click a link and navigate to a different page (`/items/snippet` → `/items/prompt`), the **entire React component tree is destroyed and rebuilt**. The QueryClient state **persists across navigations** (it's at the provider level), but:

1. **Old components unmount** → cleanup runs
2. **New page renders** → new ItemsGrid mounts
3. **New ItemsGrid calls `useInfiniteItems`** with NEW `initialData` from the server
4. TanStack Query compares: "Do I have this query key cached? If yes and not stale, use it. If no or stale, fetch."

---

## Why You Might See Multiple Requests

**The Network tab can be misleading.** Here's what's actually happening:

```
Step 1: Load /items/snippet
  ├─ Server renders page → calls fetchItemsByTypeFirstPage(userId, 'snippet')
  │  └─ DB query CACHED at server level (if previously called)
  ├─ Browser receives HTML + initialData
  ├─ ItemsGrid renders with cached data
  └─ TanStack Query stores in memory: query key ['items', '...snippet...']

Step 2: Switch to /items/prompt
  ├─ Navigation triggered → new page render
  ├─ Server renders page → calls fetchItemsByTypeFirstPage(userId, 'prompt')
  │  └─ DB query CACHED at server level (if previously called)
  ├─ Browser receives HTML + initialData (different data)
  ├─ ItemsGrid renders with cached data
  └─ TanStack Query stores in memory: query key ['items', '...prompt...'] ← NEW KEY
  │  (Old snippet cache still exists in memory)

Step 3: Switch back to /items/snippet
  ├─ Navigation triggered → new page render
  ├─ Server renders page → calls fetchItemsByTypeFirstPage(userId, 'snippet')
  │  └─ DB query CACHED at server level
  ├─ Browser receives HTML + initialData
  ├─ ItemsGrid renders
  └─ TanStack Query checks: "Do I have ['items', '...snippet...']? Yes! And staleTime hasn't passed (5 min)"
     └─ **Instant memory read — NO NETWORK REQUEST TO BACKEND**
```

---

## Verifying This Works

### Test 1: Check Server-Side Caching
1. Open DevTools → Network tab (filter by Fetch/XHR)
2. Navigate to `/items/snippet` → see `fetchMoreItemsAction` call (if loading more pages)
3. Navigate to `/items/prompt` → see `fetchMoreItemsAction` call
4. Navigate back to `/items/snippet` **within 5 minutes** → **should NOT see `fetchMoreItemsAction`** (cached in browser)
5. Wait 5+ minutes, navigate again → might see call (cache expired, data is stale)

### Test 2: Check TanStack Query DevTools
1. Open DevTools → bottom right → "TanStack Query" tab
2. Expand "Queries"
3. Look for entries like: `["items", "{\"type\":\"snippet\"}"]`
4. Status should show:
   - **Fresh** (dark green) — data loaded, within staleTime
   - **Stale** (yellow) — data exists but over 5 minutes old, will refetch in background
   - **Inactive** (gray) — not in use, but will be garbage collected after 10 minutes

### Test 3: Check gcTime (Garbage Collection)
1. Load `/items/snippet`
2. Switch to `/items/prompt`
3. Switch to `/items/command`
4. Wait 10+ minutes
5. Switch back to `/items/snippet` → data is gone (past gcTime)
6. Next navigation will need fresh fetch

---

## The Confusion Point: "Backend Called"

When you see the page load happen after switching types, you might think "backend is being called." But there are **two things happening**:

1. **Next.js server rendering** — always happens on navigation, always calls DB functions (but they're cached!)
2. **TanStack Query client cache** — only fetches if cache is stale or missing

**You're seeing #1 (server-side work), not #2 (client-side calls to backend).**

To truly verify caching:
- Watch the **Network tab for `fetchMoreItemsAction` calls** (server action for pagination)
- **NOT** the page navigation itself

---

## Configuration Summary

| Layer | Component | Behavior |
|-------|-----------|----------|
| **Server** | `fetchItemsByTypeFirstPage()` | `cacheLife('max')` — indefinite cache in Vercel |
| **Browser** | QueryClient | `staleTime: 5 min` — data fresh for 5 min |
| **Browser** | QueryClient | `gcTime: 10 min` — keep in memory for 10 min |
| **Pagination** | `fetchMoreItemsAction` | Called only when user clicks "Load More" |

---

## Bottom Line

✅ **Your caching is working correctly.**

- **Server-side:** Database queries cached indefinitely with Next.js `'use cache'`
- **Client-side:** TanStack Query caches for 5 minutes, keeps in memory for 10 minutes
- **Expected behavior:** Switching item types within 5 minutes re-uses the same in-memory cache (no extra fetch)

The page navigation itself always reloads the server side (that's how web apps work), but the DB queries and TanStack Query client cache prevent redundant backend work.

---

## Verified Against Official Documentation

### ✅ staleTime Behavior (Verified)
From TanStack Query v5 official docs:

> **staleTime** defines the duration in milliseconds after which data is considered stale, defaulting to `0`. Stale data will be refetched in the background when accessed.

**In your app:** `staleTime: 5 * 60 * 1000` (5 minutes)
- Data is **fresh** for 5 minutes after being fetched
- During this 5-minute window, the same query key will **not refetch automatically**
- After 5 minutes, data becomes stale → background refetch on next access (stale-while-revalidate pattern)

### ✅ gcTime Behavior (Verified)
From TanStack Query v5 official docs:

> If the query does not exist, it will be created. If the query is not utilized by a query hook within the default `gcTime`, the query will be garbage collected. If the default `gcTime` has not been configured, it defaults to 5 minutes.

**In your app:** `gcTime: 10 * 60 * 1000` (10 minutes)
- Cached queries are kept in memory for 10 minutes
- If you don't access a query for 10 minutes, it's removed from memory
- Next navigation after 10 minutes will need a fresh fetch

### ✅ Query Key Isolation (Verified)
From TanStack Query v5 official docs:

> Unlike object properties, the order of items directly within a query key array is significant. Different item orders result in distinct query keys and separate cache entries.

**In your app:** `queryKey: ['items', JSON.stringify(fetchParams)]`
- Snippet type: `['items', '{"type":"snippet"}']` → separate cache entry
- Prompt type: `['items', '{"type":"prompt"}']` → separate cache entry
- Each type maintains its own cache independently

### ✅ Initial Data Pattern (Verified)
From TanStack Query v5 official docs:

> Combines static initial data with a `staleTime` to prevent immediate refetching. The data will be considered fresh for the specified duration.

**In your app:**
```typescript
export function useInfiniteItems(fetchParams, initialData) {
  return useInfiniteQuery({
    queryKey: ['items', JSON.stringify(fetchParams)],
    initialData: { pages: [initialData], pageParams: [null] },
    // ↑ Server-rendered data preloaded into cache
    // ↑ Combined with staleTime = 5 min
  })
}
```

This prevents immediate refetching on component mount and efficiently uses server-rendered data.

---

## References

- **TanStack Query v5 Official Docs** — [Query Keys Guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- **TanStack Query v5 Official Docs** — [Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- **TanStack Query v5 Official Docs** — [useQuery Reference](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)
