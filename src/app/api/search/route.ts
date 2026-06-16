import { authedRoute } from '@/lib/api/route'
import { json, parseOr422 } from '@/lib/api/http'
import { searchQueryParam } from '@/lib/api/schemas/search'
import { globalSearch } from '@/lib/db/search'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'search' })

export const GET = authedRoute({}, async ({ userId, request }) => {
  const parsed = parseOr422(searchQueryParam, Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.ok) return parsed.res

  // contains + insensitive mode leverages pg_trgm GIN indexes for fuzzy substring matching
  const [items, collections] = await globalSearch(parsed.data.q, userId)
  log.info({ userId, items: items.length, collections: collections.length }, 'Global search')
  return json({ items, collections })
})
