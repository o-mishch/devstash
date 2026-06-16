import { z } from 'zod'
import { collectionFormSchema } from '@/lib/utils/validators'
import { collectionSchema } from './common'

// Request/response schemas for the collections endpoints (oRPC `oc.route()` wrappers stripped — bare
// Zod). Route handlers parse path params, query, and body from their OWN sources, so each becomes a
// separate schema (unlike oRPC's single merged `.input`). [C].

export const createCollectionInput = collectionFormSchema

// Matches the legacy PATCH body: a partial of the form fields plus `isFavorite`. `id` is no longer
// part of the body — it binds from the URL path (`idParam` in schemas/common).
export const updateCollectionInput = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export { collectionSchema }
