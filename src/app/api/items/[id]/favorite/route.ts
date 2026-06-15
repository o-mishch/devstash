import 'server-only'
import { toggleRoute } from '@/lib/api/toggle-route'
import { toggleItemFavorite } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

export const PATCH = toggleRoute({
  flagKey: 'isFavorite',
  toggle: toggleItemFavorite,
  invalidate: invalidateItemsCache,
  notFoundMessage: 'Item not found.',
  log: logger.child({ tag: 'api-item-favorite' }),
  logHeadline: 'Item favorite toggled',
})
