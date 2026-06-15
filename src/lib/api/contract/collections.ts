import { oc } from '@orpc/contract'
import { z } from 'zod'
import { collectionFormSchema } from '@/lib/utils/validators'
import { collectionSchema } from './common'

// Partial of the form schema + isFavorite — matches the legacy PATCH /api/collections/[id] body.
const updateCollectionInput = collectionFormSchema.partial().extend({
  isFavorite: z.boolean().optional(),
})

export const collectionsContract = {
  list: oc
    .route({ method: 'GET', path: '/collections' })
    .output(z.array(collectionSchema)),

  create: oc
    .route({ method: 'POST', path: '/collections', successStatus: 201 })
    .input(collectionFormSchema)
    .output(collectionSchema),

  // `{id}` binds from the URL path; remaining fields bind from the JSON body (flat, as today).
  update: oc
    .route({ method: 'PATCH', path: '/collections/{id}' })
    .input(updateCollectionInput.extend({ id: z.string() }))
    .output(collectionSchema),

  remove: oc
    .route({ method: 'DELETE', path: '/collections/{id}' })
    .input(z.object({ id: z.string() })),

  toggleFavorite: oc
    .route({ method: 'PATCH', path: '/collections/{id}/favorite' })
    .input(z.object({ id: z.string(), isFavorite: z.boolean() })),
}
