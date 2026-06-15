import 'server-only'
import { toggleRoute } from '@/lib/api/toggle-route'
import { toggleCollectionFavorite } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

export const PATCH = toggleRoute({
  flagKey: 'isFavorite',
  toggle: toggleCollectionFavorite,
  invalidate: invalidateCollectionsCache,
  notFoundMessage: 'Collection not found.',
  log: logger.child({ tag: 'api-collection-favorite' }),
  logHeadline: 'Collection favorite toggled',
})
