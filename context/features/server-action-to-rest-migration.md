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

### 4. `getCollectionPickerItemsAction` → `GET /api/collections`

**Current:** `src/actions/collections.ts` — called inside `item-detail-drawer.tsx` as `await getCollectionPickerItemsAction()` on drawer open, to populate the collection picker.

**Why migrate:** Pure data fetch, no side effects, no cache invalidation. Same pattern as `fetchMoreItemsAction`. Called from an event handler, not a form action — Server Action overhead is unjustified.

**New route:** `GET /api/collections`

**Request schema:** None — no query params needed.

**Response:** `ApiBody<CollectionWithTypes[]>` — same shape as current action return.

**Files to change:**
- Create `src/app/api/collections/route.ts`
- Update `src/components/items/drawer/item-detail-drawer.tsx` — replace `getCollectionPickerItemsAction()` with `get<CollectionWithTypes[]>('/api/collections')`
- Delete `getCollectionPickerItemsAction` from `src/actions/collections.ts`

---

### 5. Toggle Actions → `PATCH /api/items/[id]/favorite`, `PATCH /api/items/[id]/pinned`, `PATCH /api/collections/[id]/favorite`

**Current:** `toggleItemFavoriteAction`, `toggleItemPinnedAction`, `toggleCollectionFavoriteAction` — called with optimistic UI on every toggle click.

**Why migrate:** Tiny payloads wrapped in Server Action encoding. `PATCH` is the correct HTTP semantic. Consistent with the rest of the API surface.

**New routes:** `PATCH /api/items/[id]/favorite`, `PATCH /api/items/[id]/pinned`, `PATCH /api/collections/[id]/favorite`

**Request body:** `{ value: boolean }`

**Response:** `ApiBody<null>`

**Files to change:**
- Create `src/app/api/items/[id]/favorite/route.ts`, `src/app/api/items/[id]/pinned/route.ts`
- Create `src/app/api/collections/[id]/favorite/route.ts`
- Update `src/components/items/drawer/item-drawer-action-bar.tsx`
- Update `src/components/dashboard/collection-card-actions.tsx`
- Delete toggle exports from `src/actions/items.ts` and `src/actions/collections.ts`

---

### 6. Item CRUD → `POST /api/items`, `PATCH /api/items/[id]`, `DELETE /api/items/[id]`

**Current:** `createItemAction`, `updateItemAction`, `deleteItemAction` in `src/actions/items.ts`.

**Why migrate:** Uniform API surface; same auth/validation patterns as the read routes; enables future mobile/CLI clients.

**New routes:** `POST /api/items` · `PATCH /api/items/[id]` · `DELETE /api/items/[id]`

**Response:** `ApiBody<LightItem | null>` for create/update, `ApiBody<null>` for delete.

**Files to change:**
- Extend `src/app/api/items/route.ts` with `POST` handler
- Create `src/app/api/items/[id]/route.ts` with `PATCH` + `DELETE` handlers
- Delete `createItemAction`, `updateItemAction`, `deleteItemAction` from `src/actions/items.ts`
- Update all item create/edit form callers to `apiFetch`

---

### 7. Collection CRUD → `POST /api/collections`, `PATCH /api/collections/[id]`, `DELETE /api/collections/[id]`

**Current:** `createCollectionAction`, `updateCollectionAction`, `deleteCollectionAction` in `src/actions/collections.ts`.

**Why migrate:** Same reasoning as item CRUD. `GET /api/collections` already exists.

**New routes:** `POST /api/collections` · `PATCH /api/collections/[id]` · `DELETE /api/collections/[id]`

**Response:** `ApiBody<CollectionWithTypes | null>` for create/update, `ApiBody<null>` for delete.

**Files to change:**
- Extend `src/app/api/collections/route.ts` with `POST` handler
- Create `src/app/api/collections/[id]/route.ts` with `PATCH` + `DELETE` handlers
- Delete `createCollectionAction`, `updateCollectionAction`, `deleteCollectionAction` from `src/actions/collections.ts`
- Update all collection create/edit form callers to `apiFetch`

---

### 8. Profile Mutations → `PATCH|DELETE /api/profile/*`

**Current:** `updateNameAction`, `changePasswordAction`, `setInitialPasswordAction`, `changeCredentialEmailAction`, `removeCredentialsAction`, `unlinkProviderAction`, `updateMainEmailAction`, `deleteAccountAction` in `src/actions/profile.ts`.

**Why migrate:** Consistent API surface; profile components can share the same `apiFetch` pattern as all other client calls.

**New routes:**
- `PATCH /api/profile/name`
- `PATCH /api/profile/password` · `POST /api/profile/password` (set initial)
- `PATCH /api/profile/email`
- `DELETE /api/profile/credentials`
- `DELETE /api/profile/accounts/[id]`
- `PATCH /api/profile/main-email`
- `DELETE /api/profile`

**Files to change:**
- Create all routes under `src/app/api/profile/`
- Delete `src/actions/profile.ts` entirely
- Profile page components — drop `useActionState`, switch to `apiFetch`

---

### 9. Billing → `POST /api/billing/*`

**Current:** `createCheckoutSessionAction`, `createPortalSessionAction`, `cancelSubscriptionAction`, `reactivateSubscriptionAction` in `src/actions/billing.ts`.

**Why migrate:** Consistent API surface. Checkout and portal actions return a redirect URL in `{ url: string }` — client follows the redirect, replacing the server-side `redirect()` call.

**New routes:**
- `POST /api/billing/checkout` — returns `ApiBody<{ url: string }>`
- `POST /api/billing/portal` — returns `ApiBody<{ url: string }>`
- `POST /api/billing/cancel` — returns `ApiBody<null>`
- `POST /api/billing/reactivate` — returns `ApiBody<null>`

**Files to change:**
- Create all routes under `src/app/api/billing/`
- Delete `src/actions/billing.ts` entirely
- Billing UI components — drop action imports, switch to `apiFetch`; client handles redirect from `data.url`

---

### 10. Auth Form Actions → `POST /api/auth/*`

**Current:** `signInWithCredentials`, register, forgot-password, reset-password, verify-email actions in `src/actions/auth/`.

**Why migrate:** Consistent API surface. Auth form components drop `useActionState` and switch to `apiFetch`; validation errors return in `ApiBody.message` / `ApiBody.data`.

**New routes:**
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/verify-email`

**Files to change:**
- Create all routes under `src/app/api/auth/`
- Delete corresponding action exports from `src/actions/auth/` (keep `signInWithGitHub`, `signInWithGoogle`, `linkWithProviderAction`)
- Auth form pages — drop `useActionState`, switch to `apiFetch`

---

## What Stays as Server Actions

| Actions | Reason |
|---|---|
| `signInWithGitHub`, `signInWithGoogle`, `linkWithProviderAction` | Call NextAuth `signIn()` which handles redirect internally — cannot be REST |
| `updateEditorPreferencesAction` | Low-signal settings mutation; not part of this migration |
| Streaming AI responses | Separate future feature |

---

## Implementation Rules

- All new routes use `apiRoute()` from `src/lib/api` — no per-route try/catch
- Auth: read session inside route, scope all DB queries to `session.user.id`
- Validation: Zod on query params / request body before any DB access
- Rate limiting: carry over the same limits from the actions using `src/lib/infra/rate-limit.ts`
- Client calls use `apiFetch` from `src/lib/api/api-fetch` — no raw `fetch()`
- Hook updates: swap action import for `apiFetch` call; `ApiBody<T>` response shape stays the same so React Query logic is unchanged

## Status

In Progress — sections 1–3 complete; section 4 (`GET /api/collections`) pending; sections 5–10 not started
