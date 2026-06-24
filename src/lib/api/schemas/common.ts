import { z } from 'zod'

// Shared response schemas for the route-handlers API (the route-handlers + zod-openapi successor to
// contract/common.ts). [C] — pure Zod, no server-only imports; imported by route handlers, the
// OpenAPI path declarations, and (as generated types only) the browser client. Reused output
// schemas carry a `.meta({ id })` so `zod-openapi` emits a single $ref component instead of inlining
// the shape across operations — `.meta({ id })` alone is enough; we keep the default
// `reused: 'inline'` (see spec.ts for why `'ref'` is the wrong choice in v6). Domains are added here
// as they migrate.

// --- shared request schemas ---

// Single `{ id: string }` path param for the `{id}` dynamic routes (collections, items, download).
export const idParam = z.object({ id: z.string().trim().min(1, 'ID is required.') })

// Favorite toggle body shared by the collection and item favorite routes.
export const toggleFavoriteInput = z.object({ isFavorite: z.boolean() })

// REST-native error body returned by `problem()` — a human-readable `message` plus optional
// structured `data` (e.g. flattened validation errors). Referenced by every error response so the
// generated client types `error` as `{ message }` (not `never`). Output-only.
export const problemSchema = z
  .object({
    message: z.string(),
  })
  .meta({ id: 'Problem' })

export const itemTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    color: z.string(),
    isSystem: z.boolean(),
  })
  .meta({ id: 'ItemType' })

// Mirrors CollectionWithTypes (src/types/collection.ts). The schema keeps `z.coerce.date` so the
// OpenAPI `override` emits `format: date-time` (→ `string` on the generated client) while
// server-side parsing still yields a Date. `createdAt` travels over JSON as an ISO string.
export const collectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isFavorite: z.boolean(),
    createdAt: z.coerce.date<Date>(),
    itemCount: z.number(),
    dominantColor: z.string().nullable(),
    types: z.array(itemTypeSchema),
  })
  .meta({ id: 'Collection' })
