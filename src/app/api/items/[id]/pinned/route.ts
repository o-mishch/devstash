import 'server-only'
import { toggleRoute } from '@/lib/api/toggle-route'
import { toggleItemPinned } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

export const PATCH = toggleRoute({
  flagKey: 'isPinned',
  toggle: toggleItemPinned,
  invalidate: invalidateItemsCache,
  notFoundMessage: 'Item not found.',
  log: logger.child({ tag: 'api-item-pinned' }),
  logHeadline: 'Item pinned toggled',
})
