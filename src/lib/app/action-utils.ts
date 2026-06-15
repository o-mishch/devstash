import { ApiResponse } from '@/lib/api'
import { withAuth } from '@/lib/session'
import { logger } from '@/lib/infra/pino'
import type { ApiBody } from '@/types/api'

const log = logger.child({ tag: 'actions' })

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
      log.info({ entityName, entityId, flag, userId }, `toggled ${entityName}`)
      return ApiResponse.OK()
    }, `toggle${entityName}Action`)
  }
}
