import 'server-only'
import { toggleRoute } from '@/lib/api/toggle-route'
import { toggleItemPinned } from '@/lib/db/items'
import { invalidateItemsCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'

export const PATCH = toggleRoute({
  flagKey: 'isPinned',
  toggle: toggleItemPinned,
  invalidate: invalidateItemsCache,
  notFoundMessage: 'Item not found.',
  log: createLogger('api-item-pinned'),
  logHeadline: 'Item pinned toggled',
})
