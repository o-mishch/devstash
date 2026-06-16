import { z } from 'zod'
import { createItemSchema, itemMutationSchema } from '@/lib/utils/validators'

// Request/response schemas for the items endpoints (oRPC `oc.route()` wrappers stripped — bare Zod).
// Route handlers parse path params, query, and body from their OWN sources, so each becomes a
// separate schema (unlike oRPC's single merged `.input`). Reused output schemas carry a
// `.meta({ id })` so `zod-openapi` emits a single $ref component instead of inlining the shape
// across operations. [C].

// --- requests ---

// POST /items body — full create payload (Pro/file/limit checks run in the handler).
export const createItemInput = createItemSchema

// PATCH /items/{id} body — the mutable fields; `id` binds from the URL path, not the body.
export const updateItemInput = itemMutationSchema

export const togglePinnedInput = z.object({ isPinned: z.boolean() })

// GET /items strict validation — discriminated on `type`; `cursor` drives keyset pagination and the
// type-specific field (`typeName`/`collectionId`) is required per variant. Parsed in the handler
// from the URL search params.
export const fetchItemsQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recent'), cursor: z.string().optional() }),
  z.object({
    type: z.literal('type'),
    typeName: z.string().trim().min(1, 'Item type is required.'),
    cursor: z.string().optional(),
  }),
  z.object({
    type: z.literal('collection'),
    collectionId: z.string().trim().min(1, 'Collection is required.'),
    cursor: z.string().optional(),
  }),
  z.object({ type: z.literal('favorites'), cursor: z.string().optional() }),
])

// Flat shape for the OpenAPI query declaration + generated client types — each key becomes a
// `in: query` parameter. The strict discriminated-union validation above runs in the handler; this
// is just the wire/param surface (a loose superset of the four variants).
export const itemsQueryParam = z.object({
  type: z.enum(['recent', 'type', 'collection', 'favorites']),
  typeName: z.string().optional(),
  collectionId: z.string().optional(),
  cursor: z.string().optional(),
})

// --- responses ---

// Slim type shape used in list responses (SlimItemType) — icon/color resolved client-side.
const slimItemTypeSchema = z.object({ name: z.string() })

// Mirrors LightItem (src/types/item.ts). The schema keeps `z.coerce.date` so the OpenAPI `override`
// emits `format: date-time` (→ `string` on the generated client). Unlike Collection, LightItem is
// fetched AND rendered client-side, so its hand-written TS type is `string` too (§6.4 Option A).
export const lightItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    createdAt: z.coerce.date<Date>(),
    itemType: slimItemTypeSchema,
    descriptionPreview: z.string().nullable(),
    contentPreview: z.string().nullable(),
    url: z.string().nullable(),
    tags: z.array(z.string()),
    fileName: z.string().nullable(),
    fileSize: z.number().nullable(),
    isFavorite: z.boolean(),
    isPinned: z.boolean(),
  })
  .meta({ id: 'LightItem' })

// Mirrors ItemsPage — keyset page of LightItems.
export const itemsPageSchema = z
  .object({
    items: z.array(lightItemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'ItemsPage' })

// Mirrors ItemDetails (fetched on drawer open).
export const itemDetailsSchema = z
  .object({
    description: z.string().nullable(),
    updatedAt: z.coerce.date<Date>(),
    collections: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .meta({ id: 'ItemDetails' })

// Mirrors ItemSavedDetails — returned by PATCH /items/{id}. Defined standalone (not `.extend`) so it
// gets its own clean $ref component.
export const itemSavedDetailsSchema = z
  .object({
    description: z.string().nullable(),
    updatedAt: z.coerce.date<Date>(),
    collections: z.array(z.object({ id: z.string(), name: z.string() })),
    url: z.string().nullable(),
    tags: z.array(z.string()),
    isFavorite: z.boolean(),
    isPinned: z.boolean(),
  })
  .meta({ id: 'ItemSavedDetails' })

// Mirrors ItemContent (fetched separately for content-bearing types).
export const itemContentSchema = z
  .object({
    content: z.string().nullable(),
    language: z.string().nullable(),
  })
  .meta({ id: 'ItemContent' })
