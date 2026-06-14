import 'server-only'
import { authenticatedRoute, ApiResponse } from '@/lib/api'
import { parseOrFail, collectionFormSchema } from '@/lib/utils/validators'
import { getAllCollections, createCollection as dbCreateCollection } from '@/lib/db/collections'
import { canCreateCollection, FREE_TIER_COLLECTION_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'

const log = createLogger('api-collections')

export const GET = authenticatedRoute(async (_request, _context, { userId }) => {
  const collections = await getAllCollections(userId)
  return ApiResponse.OK(collections)
})

export const POST = authenticatedRoute(async (request, _context, { userId, isPro }) => {
  const body: unknown = await request.json()
  const parsed = parseOrFail(collectionFormSchema, body)
  if (!parsed.success) return parsed.response

  const canCreate = await canCreateCollection(userId, isPro)
  if (!canCreate) {
    return ApiResponse.FORBIDDEN(
      `You have reached your free tier limit of ${FREE_TIER_COLLECTION_LIMIT} collections. Please upgrade to Pro.`,
    )
  }

  const created = await dbCreateCollection(userId, parsed.data)
  invalidateCollectionsCache(userId)
  log.info('Collection created', { userId, name: parsed.data.name })
  return ApiResponse.CREATED(created)
})
