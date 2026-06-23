import { z } from 'zod'
import { lightItemSchema } from '@/lib/api/schemas/items'

// Request/response schemas for the search endpoint (oRPC `oc.route()` wrappers stripped — bare Zod).
// No Pro/rate-limit. [C].

export const searchQueryParam = z.object({ q: z.string().trim().min(1, 'Search query is required') })

// Slim collection shape (SidebarCollection) — no type chips, no dates.
const sidebarCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isFavorite: z.boolean(),
  itemCount: z.number(),
  dominantColor: z.string().nullable(),
})

// Mirrors SearchResult. Items are full LightItems so the drawer opens fully hydrated from a search hit.
export const searchResultSchema = z
  .object({
    items: z.array(lightItemSchema),
    collections: z.array(sidebarCollectionSchema),
  })
  .meta({ id: 'SearchResult' })
