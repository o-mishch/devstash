import 'server-only'
import { authed } from '../orpc'
import { globalSearch } from '@/lib/db/search'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'search' })

export const searchRouter = {
  search: authed.search.search.handler(async ({ input, context }) => {
    // contains + insensitive mode leverages pg_trgm GIN indexes for fuzzy substring matching
    const [items, collections] = await globalSearch(input.q, context.userId)
    log.info({ userId: context.userId, items: items.length, collections: collections.length }, 'Global search')
    return { items, collections }
  }),
}
