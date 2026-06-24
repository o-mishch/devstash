import { authedRouteWithParams } from '@/lib/api/route'
import { json, problem, parseOr422 } from '@/lib/api/http'
import { idParam } from '@/lib/api/schemas/common'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getItemContent } from '@/lib/db/items'

type RouteParams = Awaited<RouteContext<'/api/items/[id]/content'>['params']>

export const GET = authedRouteWithParams<RouteParams>({}, async ({ userId, params }) => {
  const parsedParams = parseOr422(idParam, params)
  if (!parsedParams.ok) return parsedParams.res
  const content = await getItemContent(userId, parsedParams.data.id)
  if (!content) return problem(404, ErrorMessage.ITEM_NOT_FOUND)
  return json(content)
})
