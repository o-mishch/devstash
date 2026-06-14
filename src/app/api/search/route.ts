import 'server-only'
import { z } from 'zod'
import { authenticatedRoute } from '@/lib/api'
import { ApiResponse } from '@/lib/api'
import { parseOrFail } from '@/lib/utils/validators'
import { createLogger } from '@/lib/infra/logger'
import { globalSearch } from '@/lib/db/search'
import type { SearchResult } from '@/types/search'

const log = createLogger('search')

const searchSchema = z.object({
  q: z.string().trim().min(1, 'Search query is required'),
})

export const GET = authenticatedRoute(async (request, _context, { userId }) => {
  const { searchParams } = new URL(request.url)
  const raw = { q: searchParams.get('q') ?? '' }

  const parsed = parseOrFail(searchSchema, raw)
  if (!parsed.success) return parsed.response

  const { q } = parsed.data

  // Use contains with insensitive mode to leverage pg_trgm GIN indexes for fuzzy substring matching
  const [items, collections] = await globalSearch(q, userId)

  log.info('Global search', { userId, items: items.length, collections: collections.length })

  return ApiResponse.OK<SearchResult>({ items, collections })
})
