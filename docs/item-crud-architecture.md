# Item CRUD Architecture

A unified system for creating, reading, updating, and deleting all 7 item types. One action file handles all mutations; one dynamic route handles all list views; shared components adapt their UI based on the item's `contentType`.

---

## File Structure

```
src/
├── actions/
│   └── items.ts                      # All item mutations (create, update, delete, toggle)
│
├── lib/db/
│   └── items.ts                      # All item queries (list, get, stats) — already partially exists
│
├── app/(app)/
│   └── items/
│       └── [type]/
│           ├── page.tsx              # Items list for a specific type (server component)
│           └── loading.tsx           # Skeleton while data loads
│
└── components/
    └── items/
        ├── item-list.tsx             # List of ItemCard rows (client)
        ├── item-card.tsx             # Single item row with actions menu (client)
        ├── item-drawer.tsx           # Create/edit sheet overlay (client)
        ├── item-form.tsx             # Form that adapts by contentType (client)
        ├── item-form-text.tsx        # Fields for TEXT types
        ├── item-form-url.tsx         # Fields for URL types
        └── item-form-file.tsx        # Fields for FILE types (Pro only)
```

---

## Routing: `/items/[type]`

The `[type]` segment maps directly to the `ItemType.name` slug (e.g. `snippet`, `prompt`, `link`).

```
/items/snippet   → Snippets
/items/prompt    → Prompts
/items/command   → Commands
/items/note      → Notes
/items/file      → Files      (Pro only)
/items/image     → Images     (Pro only)
/items/link      → Links
```

**Page responsibilities (`page.tsx`):**
1. Validate that `params.type` is a known system type; return 404 otherwise.
2. Fetch the `ItemType` record to get icon, color, and `contentType`.
3. Fetch all items of that type for the current user.
4. Pass data to a client `ItemList` component.

```tsx
// src/app/(app)/items/[type]/page.tsx
import { notFound } from 'next/navigation'
import { getItemsByType, getItemTypeBySlug } from '@/lib/db/items'
import { getCurrentUserId } from '@/lib/db/collections'
import { ItemList } from '@/components/items/item-list'
import { SYSTEM_TYPE_ORDER } from '@/lib/db/items'

interface ItemTypePageProps {
  params: Promise<{ type: string }>
}

export default async function ItemTypePage({ params }: ItemTypePageProps) {
  const { type } = await params

  if (!SYSTEM_TYPE_ORDER.includes(type)) notFound()

  const userId = await getCurrentUserId()
  if (!userId) notFound()

  const [itemType, items] = await Promise.all([
    getItemTypeBySlug(type, userId),
    getItemsByType(userId, type),
  ])

  if (!itemType) notFound()

  return <ItemList itemType={itemType} initialItems={items} />
}
```

---

## Data Fetching: `src/lib/db/items.ts`

New functions to add alongside the existing dashboard helpers:

```typescript
// Fetch the ItemType record by slug name
export async function getItemTypeBySlug(
  slug: string,
  userId: string
): Promise<SidebarItemType | null>

// Fetch all items of a given type for a user, ordered by pinned-first then updated
export async function getItemsByType(
  userId: string,
  typeName: string,
  limit = 200
): Promise<ItemDetail[]>

// Fetch a single item with full fields (for edit form)
export async function getItemById(
  id: string,
  userId: string
): Promise<ItemDetail | null>
```

**`ItemDetail` interface** (extends `DashboardItem` with full content fields):

```typescript
export interface ItemDetail {
  id: string
  title: string
  contentType: string       // 'TEXT' | 'FILE' | 'URL'
  content: string | null    // TEXT types
  fileUrl: string | null    // FILE types
  fileName: string | null
  fileSize: number | null
  url: string | null        // URL types
  description: string | null
  language: string | null
  isFavorite: boolean
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
  itemType: { id: string; name: string; icon: string; color: string }
  tags: string[]
  collections: Array<{ id: string; name: string }>
}
```

---

## Mutations: `src/actions/items.ts`

All mutations live in one file. The `withAuth` pattern from `src/actions/profile.ts` is reused for session guarding.

```typescript
'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type { ActionState } from '@/types/actions'

// ── Create ────────────────────────────────────────────────────────────────────
export async function createItemAction(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState>

// ── Update ────────────────────────────────────────────────────────────────────
export async function updateItemAction(
  _prev: ActionState | null,
  formData: FormData
): Promise<ActionState>

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deleteItemAction(id: string): Promise<ActionState>

// ── Toggles (optimistic-friendly) ─────────────────────────────────────────────
export async function toggleFavoriteAction(id: string): Promise<ActionState>
export async function togglePinnedAction(id: string): Promise<ActionState>
```

### Input shape (FormData fields)

The action reads a flat FormData payload. Field presence determines which content fields are written:

| FormData key     | Types that use it           | Notes |
|------------------|-----------------------------|-------|
| `id`             | update only                 | Item ID |
| `itemTypeId`     | create only                 | Resolved to `contentType` in action |
| `title`          | all                         | Required |
| `description`    | all                         | Optional |
| `content`        | TEXT types                  | Required for TEXT |
| `language`       | snippet only                | Optional |
| `url`            | URL types                   | Required for URL |
| `fileUrl`        | FILE types                  | Set by upload action before submit |
| `fileName`       | FILE types                  | |
| `fileSize`       | FILE types                  | |
| `tags`           | all                         | Comma-separated string |
| `collections`    | all                         | Comma-separated collection IDs |

The action looks up the `ItemType` to determine `contentType`, then validates only the fields that apply. Type-specific validation (e.g. requiring `content` for TEXT, `url` for URL) lives in the action, not the form component.

### Tag & collection handling

Tags are upserted by name and connected via `set`. Collections are connected by ID.

```typescript
await prisma.item.update({
  where: { id },
  data: {
    tags: {
      set: [],
      connectOrCreate: tagNames.map((name) => ({
        where: { name },
        create: { name },
      })),
    },
    collections: {
      deleteMany: {},
      createMany: {
        data: collectionIds.map((collectionId) => ({ collectionId })),
      },
    },
  },
})
```

---

## Components

### `ItemList` (client)

Receives `itemType` and `initialItems` as props. Manages:
- Local optimistic state for toggles and deletes
- "New Item" button that opens `ItemDrawer`
- Empty state when no items exist

```tsx
interface ItemListProps {
  itemType: SidebarItemType
  initialItems: ItemDetail[]
}
```

### `ItemCard` (client)

Renders one item row. Adapts the secondary line by `contentType`:
- TEXT → `description` or a truncated `content` preview
- URL → the `url` domain
- FILE → `fileName` + formatted `fileSize`

Has a `DropdownMenu` with: Edit, Toggle Favorite, Toggle Pin, Delete (with confirmation).

### `ItemDrawer` (client)

A `Sheet` overlay that hosts `ItemForm`. Used for both create and edit:
- Create: opened with no item (form starts empty, `itemTypeId` preset)
- Edit: opened with an `ItemDetail` (form pre-populated)

Calls `createItemAction` or `updateItemAction` via `useActionState`. On success, refreshes the list via `router.refresh()`.

### `ItemForm` (client)

Shared form wrapper. Renders the appropriate sub-form based on `contentType`:

```tsx
{contentType === 'TEXT' && <ItemFormText ... />}
{contentType === 'URL'  && <ItemFormUrl ... />}
{contentType === 'FILE' && <ItemFormFile ... />}
```

Always renders: `title`, `description`, `tags` (multi-value input), `collections` (multi-select).

### `ItemFormText` (client)

Renders: `content` (markdown/code editor), `language` (only when `itemType.name === 'snippet'`).

### `ItemFormUrl` (client)

Renders: `url` (text input with URL validation).

### `ItemFormFile` (client)

Renders: file drop zone. Uploads to R2 via a separate API route (`POST /api/upload`) which returns `{ fileUrl, fileName, fileSize }`. These are stored in hidden form fields before the action is called.

---

## Where Type-Specific Logic Lives

| Concern | Location |
|---------|----------|
| Content type validation (is `content` required?) | `src/actions/items.ts` |
| `language` field visibility | `ItemFormText` component |
| File upload UX | `ItemFormFile` component |
| URL validation | `ItemFormUrl` component |
| Icon and color rendering | `ItemTypeIcon` from `src/lib/icon-utils.tsx` |
| Pro gate (File/Image) | `ItemList` — shows upgrade prompt instead of form |
| Secondary line preview | `ItemCard` — switches on `contentType` |
| Syntax highlighting | `ItemCard` / detail view — uses `language` field |

The action is content-class-aware (TEXT / FILE / URL) but **not type-aware** — it doesn't branch on whether the type is `snippet` vs `note`. The form components own that distinction.

---

## Data Flow Summary

```
User clicks "New Item"
  → ItemDrawer opens (ItemForm pre-filled with itemTypeId)
  → User fills form, submits
  → createItemAction (server action)
      → auth check (withAuth)
      → look up ItemType → derive contentType
      → validate required fields for that contentType
      → prisma.item.create + tag upsert + collection connect
      → return ActionState (success or error)
  → ItemList receives success → router.refresh() reloads items

User clicks Edit on ItemCard
  → ItemDrawer opens (ItemForm pre-filled with ItemDetail)
  → User edits, submits
  → updateItemAction → prisma.item.update + tag set + collection sync
  → router.refresh()

User clicks Delete
  → Confirmation dialog
  → deleteItemAction → prisma.item.delete (cascades ItemCollection rows)
  → Optimistic removal from list, router.refresh()

User clicks Favorite/Pin star
  → toggleFavoriteAction / togglePinnedAction (no formData, just item id)
  → Optimistic toggle in ItemList state, router.refresh() in background
```
