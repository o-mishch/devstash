import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { createLogger } from '@/lib/infra/logger'
import type { ApiBody } from '@/types/api'

const log = createLogger('actions')

export function createToggleAction(
  dbAction: (userId: string, entityId: string, flag: boolean) => Promise<boolean>,
  invalidateCache: (userId: string) => void,
  entityName: string
) {
  return async function toggleAction(entityId: string, flag: boolean): Promise<ApiBody<null>> {
    return withAuth(async ({ userId }) => {
      const ok = await dbAction(userId, entityId, flag)
      if (!ok) return ApiResponse.NOT_FOUND(`${entityName} not found.`)
      
      invalidateCache(userId)
      log.info(`toggled ${entityName}:${entityId} flag:${flag} user:${userId}`)
      return ApiResponse.OK()
    }, `toggle${entityName}Action`)
  }
}
