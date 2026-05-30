# Infinite Scroll for Item Lists

## Overview

Replace bulk item loading with cursor-based pagination and infinite scroll across all item list views: Dashboard Recent Items, `/items/[type]` pages, and `/collections/[id]` detail pages.

## Motivation

The current bulk-load approach breaks in production when a user accumulates many large items. `getItemsByType` and `getItemsByCollection` attempt to cache up to 500 full `Item` records (including all content fields and the collections join) in the Next.js Data Cache, which has a **hard 2MB limit per entry**. Exceeding it causes an unhandled rejection and a broken page load:

```
Error: Failed to set Next.js data cache, items over 2MB can not be cached (11394534 bytes)
```

This limit is not configurable — the fix must come from keeping cache entries small. Fetching only 20 `LightItem` records with truncated previews reduces each first-page cache entry to ~10KB, well within limits. This feature resolves the crash and improves load performance simultaneously.

## Requirements

- Server-render the first page (20 items) on initial load; fetch subsequent pages on demand as the user scrolls to the bottom
- Page size: `ITEMS_PAGE_SIZE = 20`, defined as a constant in `src/lib/utils/constants.ts`
- Each chunk load target: **<500ms** — eliminates the current 20+ second waits with large item sets
- Use cursor-based pagination (not OFFSET) — each page fetch is an O(1) index seek regardless of list depth; no performance degradation as data grows
- DOM always renders only the visible window of rows; `@tanstack/react-virtual` is kept and extended with the scroll trigger
- All fetched pages accumulate in a front-end store — items are never re-fetched on scroll
- Dashboard Pinned section is unchanged (small bounded full-`Item` list)
- Add Vitest tests for new DB functions and server actions

## Cursor Pagination

Use Prisma cursor pagination: `{ skip: 1, cursor: { id }, take: ITEMS_PAGE_SIZE + 1, orderBy: [createdAt DESC, id DESC] }`.

- `skip: 1` skips only the cursor item itself — constant cost, not O(n)
- `take: n + 1` detects whether a next page exists without a separate COUNT query
- CUID ids are time-sortable, making them stable as a cursor for `createdAt DESC` ordering

## LightItem Type

Introduce `LightItem` in `src/types/item.ts` — a minimal type for card/row rendering, separate from the full `Item` used in the drawer.

**Fields included** (only what cards actually render):

| Field | Used by |
|---|---|
| `id` | All cards — drawer open, download URL |
| `title` | All cards |
| `createdAt` | All cards — date display |
| `itemType` | All cards — icon + color |
| `descriptionPreview` | ItemRow, ItemCard — first 150 chars |
| `contentPreview` | ItemRow, ItemCard — first 150 chars; null for file/url types |
| `url` | Copy button on link items |
| `tags` | ItemRow (max 2), ItemCard (max 3) |
| `fileUrl` | ImageCard thumbnail + FileRow download |
| `fileName` | FileRow display + download |
| `fileSize` | FileRow display |

**Fields excluded:** full `description`, full `content`, `isFavorite`, `isPinned`, `updatedAt`, `language`, `contentType`, `collections` join.

Truncation of `description` and `content` to 150 chars happens in the `toLightItem()` mapper on the app server — no DB schema change needed. This significantly reduces browser payload for large code/text items.

`isFavorite`/`isPinned` excluded because no card renders them — the drawer fetches the full item before showing the toolbar.

## Caching Model

Two independent layers:

**Back-end (Next.js Data Cache):** first page of each query cached via existing `withDataCache`. Tags (`CacheTags.recentItems`, `CacheTags.itemsByType`, `CacheTags.itemsByCollection`) and `invalidateItemsCache` are **unchanged**.

**Front-end store (`useReducer` + Context):** accumulates all fetched pages for the session in a flat `LightItem[]`. Seeded from SSR props on page load. The virtualizer reads from this store — items already in memory are never re-requested.

Cursor pages (page 2+) bypass the back-end cache — each cursor is unique and caching them offers no benefit.

## Front-end Store

New file `src/context/items-store-context.tsx` — `useReducer` + Context with four actions:

- `APPEND_PAGE` — add a new page to the list, update cursor
- `UPDATE_ITEM` — patch a single item by id (used after drawer edits)
- `REMOVE_ITEM` — remove a single item by id (used after drawer delete)
- `SET_LOADING` — guard against concurrent fetches

One store instance per list view, provided by the page's client root component. The drawer accesses the store via `useItemsStore()` for mutations.

## Drawer Integration

When a card with `LightItem` is clicked:
- Drawer opens **instantly** prepopulated with all available light fields (title, previews, type icon, tags, date)
- Absent fields (full content/editor, collections, language, favorite/pin buttons) show `Skeleton` placeholders
- Full item fetched async via existing `GET /api/items/[id]`; skeletons replaced on resolve

After drawer mutations, `router.refresh()` is **removed** and replaced with:
- **Edit:** `invalidateItemsCache` + store `UPDATE_ITEM`
- **Delete:** `invalidateItemsCache` + store `REMOVE_ITEM` + drawer closes

Type guard `'content' in item` distinguishes `LightItem` from full `Item` throughout the drawer.

## Scroll Trigger

New file `src/hooks/use-intersection-observer.ts` — thin native `IntersectionObserver` wrapper returning `{ ref, inView }`. No new npm dependency.

A sentinel element is placed after the last virtual row. When it enters the viewport, `fetchMore*Action(nextCursor)` is called. The sentinel is removed when `hasMore === false`.

## Copy Button

`ItemCard` copy logic simplified to `url ?? title` (drops `content` which is unavailable in `LightItem`). Full content copy remains available in the drawer once the full item loads.

## New Server Actions

Three auth-guarded server actions in `src/actions/items.ts`:
- `fetchMoreRecentItemsAction(cursor)`
- `fetchMoreItemsByTypeAction(typeName, cursor)`
- `fetchMoreItemsByCollectionAction(collectionId, cursor)`

Return `ApiBody<ItemsPage | null>`. No back-end caching.

## Files Modified

| File | Change |
|---|---|
| `src/types/item.ts` | Add `LightItem`, `ItemsPage` |
| `src/lib/utils/constants.ts` | Add `ITEMS_PAGE_SIZE = 20` |
| `src/lib/db/items.ts` | Add `LIGHT_ITEM_SELECT`, `toLightItem`, three `*Page` query functions |
| `src/actions/items.ts` | Add three `fetchMore*` server actions; remove `router.refresh()` from mutations |
| `src/context/items-store-context.tsx` | New — `useReducer` + Context store |
| `src/hooks/use-intersection-observer.ts` | New — sentinel hook |
| `src/components/items/item-card.tsx` | Accept `LightItem`; simplify copy logic |
| `src/components/items/image-card.tsx` | Accept `LightItem` |
| `src/components/items/file-row.tsx` | Accept `LightItem` |
| `src/components/dashboard/item-row.tsx` | Accept `LightItem`; render previews |
| `src/components/items/virtual-item-grid.tsx` | Refactor: integrate store + scroll trigger |
| `src/components/items/virtual-file-list.tsx` | Refactor: integrate store + scroll trigger |
| `src/components/items/virtual-image-grid.tsx` | Refactor: integrate store + scroll trigger |
| `src/app/(app)/dashboard/_components/dashboard-recent.tsx` | Split: server (first page fetch) + client (store + virtual list) |
| `src/app/(app)/items/[type]/page.tsx` | Use `getItemsByTypePage`; pass first page as props |
| `src/app/(app)/collections/[id]/page.tsx` | Use `getItemsByCollectionPage`; pass first page as props |
| `src/context/item-drawer-context.tsx` | `openDrawer` accepts `LightItem \| Item` |
| `src/components/items/item-drawer-provider.tsx` | State typed as `LightItem \| Item`; use store for mutations |
| `src/components/items/drawer/item-detail-drawer.tsx` | Detect light vs full; prepopulate; async fetch absent fields |
| `src/actions/items.test.ts` | Tests for new server actions |
| `src/lib/db/items.test.ts` | Tests for new `*Page` functions |
