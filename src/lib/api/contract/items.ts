import { oc } from '@orpc/contract'
import { z } from 'zod'
import { createItemSchema, itemMutationSchema } from '@/lib/utils/validators'
import {
  lightItemSchema,
  itemsPageSchema,
  itemDetailsSchema,
  itemSavedDetailsSchema,
  itemContentSchema,
} from './common'

// GET /items query — discriminated on `type`; `cursor` drives keyset pagination.
export const fetchItemsQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recent'), cursor: z.string().optional() }),
  z.object({ type: z.literal('type'), typeName: z.string().trim().min(1, 'Item type is required.'), cursor: z.string().optional() }),
  z.object({ type: z.literal('collection'), collectionId: z.string().trim().min(1, 'Collection is required.'), cursor: z.string().optional() }),
  z.object({ type: z.literal('favorites'), cursor: z.string().optional() }),
])

export const itemsContract = {
  list: oc
    .route({ method: 'GET', path: '/items' })
    .input(fetchItemsQuerySchema)
    .output(itemsPageSchema),

  create: oc
    .route({ method: 'POST', path: '/items', successStatus: 201 })
    .input(createItemSchema)
    .output(lightItemSchema),

  update: oc
    .route({ method: 'PATCH', path: '/items/{id}' })
    .input(itemMutationSchema.extend({ id: z.string() }))
    .output(itemSavedDetailsSchema),

  remove: oc
    .route({ method: 'DELETE', path: '/items/{id}' })
    .input(z.object({ id: z.string() })),

  getDetails: oc
    .route({ method: 'GET', path: '/items/{id}/details' })
    .input(z.object({ id: z.string() }))
    .output(itemDetailsSchema),

  getContent: oc
    .route({ method: 'GET', path: '/items/{id}/content' })
    .input(z.object({ id: z.string() }))
    .output(itemContentSchema),

  toggleFavorite: oc
    .route({ method: 'PATCH', path: '/items/{id}/favorite' })
    .input(z.object({ id: z.string(), isFavorite: z.boolean() })),

  togglePinned: oc
    .route({ method: 'PATCH', path: '/items/{id}/pinned' })
    .input(z.object({ id: z.string(), isPinned: z.boolean() })),
}
