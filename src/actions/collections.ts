'use server'

import { auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { createCollection as dbCreateCollection } from '@/lib/db/collections'
import { invalidateCollectionsCache } from '@/lib/cache'
import { collectionFormSchema } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'
import type { CollectionWithTypes } from '@/types/collection'
import type { CreateCollectionInput } from '@/lib/db/collections'

export async function createCollectionAction(raw: CreateCollectionInput): Promise<ApiBody<CollectionWithTypes | null>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const parsed = collectionFormSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Validation failed'
    return ApiResponse.VALIDATION_ERROR(message)
  }

  try {
    const created = await dbCreateCollection(session.user.id, parsed.data)
    invalidateCollectionsCache(session.user.id)
    return ApiResponse.CREATED(created)
  } catch (error) {
    console.error('[createCollectionAction] Error:', error)
    return ApiResponse.INTERNAL_ERROR()
  }
}
