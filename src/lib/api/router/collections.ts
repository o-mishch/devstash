import 'server-only'
import { ORPCError } from '@orpc/server'
import { authed } from '../orpc'
import { ErrorMessage } from '../error-messages'
import {
  getAllCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  getCollectionById,
  toggleCollectionFavorite,
} from '@/lib/db/collections'
import { canCreateCollection, FREE_TIER_COLLECTION_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

export const collectionsRouter = {
  list: authed.collections.list.handler(({ context }) => getAllCollections(context.userId)),

  create: authed.collections.create.handler(async ({ input, context }) => {
    if (!(await canCreateCollection(context.userId, context.isPro))) {
      throw new ORPCError('FORBIDDEN', {
        message: `You have reached your free tier limit of ${FREE_TIER_COLLECTION_LIMIT} collections. Please upgrade to Pro.`,
      })
    }
    const created = await createCollection(context.userId, input)
    invalidateCollectionsCache(context.userId)
    log.info({ userId: context.userId, name: input.name }, 'Collection created')
    return created
  }),

  update: authed.collections.update.handler(async ({ input, context }) => {
    const { id, ...patch } = input
    if (!(await getCollectionById(context.userId, id))) {
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.COLLECTION_NOT_FOUND })
    }
    const updated = await updateCollection(context.userId, id, patch)
    invalidateCollectionsCache(context.userId)
    log.info({ userId: context.userId, id }, 'Collection updated')
    return updated
  }),

  remove: authed.collections.remove.handler(async ({ input, context }) => {
    if (!(await getCollectionById(context.userId, input.id))) {
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.COLLECTION_NOT_FOUND })
    }
    await deleteCollection(context.userId, input.id)
    invalidateCollectionsCache(context.userId)
    log.info({ userId: context.userId, id: input.id }, 'Collection deleted')
  }),

  toggleFavorite: authed.collections.toggleFavorite.handler(async ({ input, context }) => {
    if (!(await toggleCollectionFavorite(context.userId, input.id, input.isFavorite))) {
      throw new ORPCError('NOT_FOUND', { message: ErrorMessage.COLLECTION_NOT_FOUND })
    }
    invalidateCollectionsCache(context.userId)
    log.info({ userId: context.userId, id: input.id, isFavorite: input.isFavorite }, 'Collection favorite toggled')
  }),
}
