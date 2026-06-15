import { z } from 'zod'

// Shared response schemas for the oRPC contract. [C] — pure Zod, no server-only imports;
// imported by both the server handler and the browser client (types only).

export const itemTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  isSystem: z.boolean(),
})

// Mirrors CollectionWithTypes (src/types/collection.ts). `createdAt` goes over JSON as an ISO
// string; z.coerce.date<Date>() + the client's ResponseValidationPlugin coerce it back to a Date.
export const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isFavorite: z.boolean(),
  createdAt: z.coerce.date<Date>(),
  itemCount: z.number(),
  dominantColor: z.string().nullable(),
  types: z.array(itemTypeSchema),
})

// --- items ---

// Slim type shape used in list/search responses (SlimItemType).
export const slimItemTypeSchema = z.object({ name: z.string() })

// Mirrors LightItem (src/types/item.ts). JSON dates → z.coerce.date<Date>().
export const lightItemSchema = z.object({
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

// Mirrors ItemsPage.
export const itemsPageSchema = z.object({
  items: z.array(lightItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

// Mirrors ItemDetails (fetched on drawer open).
export const itemDetailsSchema = z.object({
  description: z.string().nullable(),
  updatedAt: z.coerce.date<Date>(),
  collections: z.array(z.object({ id: z.string(), name: z.string() })),
})

// Mirrors ItemSavedDetails — returned by PATCH /items/{id}.
export const itemSavedDetailsSchema = itemDetailsSchema.extend({
  url: z.string().nullable(),
  tags: z.array(z.string()),
  isFavorite: z.boolean(),
  isPinned: z.boolean(),
})

// Mirrors ItemContent (fetched separately for content-bearing types).
export const itemContentSchema = z.object({
  content: z.string().nullable(),
  language: z.string().nullable(),
})

// --- search ---

// Mirrors SearchResultItem (slim search hit).
export const searchResultItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  itemType: slimItemTypeSchema,
  descriptionPreview: z.string().nullable(),
})

// Mirrors SidebarCollection (slim collection shape — no type chips, no dates).
export const sidebarCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isFavorite: z.boolean(),
  itemCount: z.number(),
  dominantColor: z.string().nullable(),
})

// Mirrors SearchResult.
export const searchResultSchema = z.object({
  items: z.array(searchResultItemSchema),
  collections: z.array(sidebarCollectionSchema),
})

// --- upload ---

// Mirrors PresignedPostCredential.
export const presignedPostCredentialSchema = z.object({
  url: z.string(),
  fields: z.record(z.string(), z.string()),
})

// Mirrors UploadUrlResult (expiresAt is already an ISO string — no coercion).
export const uploadUrlResultSchema = z.object({
  original: presignedPostCredentialSchema,
  thumb: presignedPostCredentialSchema.nullable(),
  expiresAt: z.string(),
})

// --- billing ---

// Mirrors BillingRedirectData — a URL the client hard-redirects to (Stripe Checkout / Portal).
export const billingRedirectSchema = z.object({ url: z.string() })

// --- auth ---

// Mirrors AuthRedirectData — a path the client navigates to after a public auth flow.
export const authRedirectSchema = z.object({ redirectTo: z.string() })

// --- download ---

// Mirrors SignedDownloadUrlResponse (expiresAt is already an ISO string — no coercion).
export const signedDownloadUrlResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
})
