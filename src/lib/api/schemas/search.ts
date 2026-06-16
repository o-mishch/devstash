import { z } from 'zod'

// Request/response schemas for the search endpoint (oRPC `oc.route()` wrappers stripped — bare Zod).
// No dates, no Pro/rate-limit. [C].

export const searchQueryParam = z.object({ q: z.string().trim().min(1, 'Search query is required') })

// Slim search hit (SearchResultItem) — icon/color resolved client-side.
const searchResultItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  itemType: z.object({ name: z.string() }),
  descriptionPreview: z.string().nullable(),
})

// Slim collection shape (SidebarCollection) — no type chips, no dates.
const sidebarCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isFavorite: z.boolean(),
  itemCount: z.number(),
  dominantColor: z.string().nullable(),
})

// Mirrors SearchResult.
export const searchResultSchema = z
  .object({
    items: z.array(searchResultItemSchema),
    collections: z.array(sidebarCollectionSchema),
  })
  .meta({ id: 'SearchResult' })
