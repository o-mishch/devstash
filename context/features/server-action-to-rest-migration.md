# Server Action → REST Migration

## Overview

Migrate Server Actions that are pure data fetches or high-frequency mutations to REST API routes. Server Actions carry multipart/form-data encoding + RSC flight format overhead on every call; for actions used in React Query `queryFn` or called on every keystroke, this overhead is measurable and unnecessary.

## Actions to Migrate (Priority Order)

### 1. `fetchMoreItemsAction` → `GET /api/items`

**Current:** `src/actions/items.ts` — called by TanStack Query `queryFn` in `use-infinite-items.ts` on every infinite scroll page load.

**Why migrate:** Highest call volume in the app. Pure data fetch, no cache invalidation, no RSC re-renders. The action overhead fires on every scroll event.

**New route:** `GET /api/items?type=recent|by-type|by-collection|favorites&typeName=snippet&collectionId=...&cursor=...`

**Request schema (query params):**
```
type: 'recent' | 'by-type' | 'by-collection' | 'favorites'
typeName?: string        (required when type=by-type)
collectionId?: string    (required when type=by-collection)
cursor?: string
```

**Response:** `ApiBody<ItemsPage>` — same shape as current action return, no change needed in the hook.

**Files to change:**
- Create `src/app/api/items/route.ts`
- Update `src/hooks/use-infinite-items.ts` — replace `queryFn` call from action to `apiFetch`
- Delete or keep `fetchMoreItemsAction` (can remove once hook is updated)

---

### 2. `globalSearchAction` → `GET /api/search`

**Current:** `src/actions/search.ts` — called by React Query in `use-global-search.ts` on every debounced keystroke.

**Why migrate:** Debounced but still fires on every search input change. Pure data fetch, no side effects. `GET` is the correct HTTP semantic for search.

**New route:** `GET /api/search?q=...`

**Request schema (query params):**
```
q: string (min 1 char)
```

**Response:** `ApiBody<SearchResult>` — same shape, no change needed in the hook.

**Files to change:**
- Create `src/app/api/search/route.ts`
- Update `src/hooks/use-global-search.ts` — replace action call with `apiFetch`
- Delete `src/actions/search.ts`

---

### 3. AI Generation Trio → `POST /api/ai/...`

**Current:** `src/actions/ai/generate-tags.ts` and `src/actions/ai/generate-descriptions.ts` — called on button click, Pro-only, rate-limited, Claude API calls.

**Why migrate:** AI calls are slow; POST routes allow streaming in the future. Rate limit 429 status is properly surfaced via HTTP. Easier to expose to future CLI/mobile clients.

**New routes:**
- `POST /api/ai/tags`
- `POST /api/ai/description`
- `POST /api/ai/collection-description`

**Request body:** Same shape as current action input schemas (JSON, not FormData).

**Response:** `ApiBody<string[] | null>` for tags, `ApiBody<{ description: string } | null>` for descriptions.

**Files to change:**
- Create `src/app/api/ai/tags/route.ts`
- Create `src/app/api/ai/description/route.ts`
- Create `src/app/api/ai/collection-description/route.ts`
- Update `src/components/items/drawer/item-drawer-edit-content.tsx` (auto-tag trigger)
- Update `src/components/items/item-create-dialog.tsx` (auto-tag + description triggers)
- Update collection form component (collection description trigger)
- Delete `src/actions/ai/generate-tags.ts` and `src/actions/ai/generate-descriptions.ts`

---

### 4. Toggle Actions → `PATCH /api/items/[id]/favorite` and `PATCH /api/items/[id]/pinned` (optional)

**Current:** `toggleItemFavoriteAction`, `toggleItemPinnedAction`, `toggleCollectionFavoriteAction` — called with optimistic UI on every toggle click.

**Why migrate:** Tiny payloads (`{ flag: true }`) wrapped in multipart encoding is wasteful. `PATCH` is the correct HTTP semantic.

**Why to skip:** Optimistic UI path is already fast; perceived latency is dominated by round-trip, not payload size. Cache invalidation (`revalidateTag`) works fine inside route handlers. Low ROI unless toggle frequency becomes a measured bottleneck.

**Decision:** Defer until toggle latency is a measured issue. Keep as Server Actions for now.

---

## What Stays as Server Actions

| Actions | Reason |
|---|---|
| All `useActionState` form actions (auth, billing, profile) | CSRF, form state/error feedback, low frequency |
| Billing redirect actions (`createCheckoutSessionAction`, `createPortalSessionAction`) | Use `redirect()` from `next/navigation` |
| OAuth actions (`signInWithGitHub`, `signInWithGoogle`) | Redirect-only |
| `createItemAction`, `updateItemAction`, `deleteItemAction` | One-shot on submit, cache invalidation is primary work |
| `createCollectionAction`, `updateCollectionAction`, `deleteCollectionAction` | Low frequency mutations |
| All profile mutations | Security-sensitive, low frequency |

---

## Implementation Rules

- All new routes use `apiRoute()` from `src/lib/api` — no per-route try/catch
- Auth: read session inside route, scope all DB queries to `session.user.id`
- Validation: Zod on query params / request body before any DB access
- Rate limiting: carry over the same limits from the actions using `src/lib/infra/rate-limit.ts`
- Client calls use `apiFetch` from `src/lib/api/api-fetch` — no raw `fetch()`
- Hook updates: swap action import for `apiFetch` call; `ApiBody<T>` response shape stays the same so React Query logic is unchanged

## Status

Planned
