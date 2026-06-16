import { authedRoute } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { createCollectionInput } from '@/lib/api/schemas/collections'
import { getAllCollections, createCollection } from '@/lib/db/collections'
import { canCreateCollection, FREE_TIER_COLLECTION_LIMIT } from '@/lib/db/usage'
import { invalidateCollectionsCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-collections' })

export const GET = authedRoute({}, async ({ userId }) => json(await getAllCollections(userId)))

export const POST = authedRoute({}, async ({ userId, isPro, request }) => {
  const parsed = parseOr422(createCollectionInput, await request.json())
  if (!parsed.ok) return parsed.res

  if (!(await canCreateCollection(userId, isPro))) {
    return problem(
      403,
      `You have reached your free tier limit of ${FREE_TIER_COLLECTION_LIMIT} collections. Please upgrade to Pro.`,
    )
  }

  const created = await createCollection(userId, parsed.data) // userId from session — IDOR-safe
  invalidateCollectionsCache(userId)
  log.info({ userId, name: parsed.data.name }, 'Collection created')
  return json(created, 201)
})
