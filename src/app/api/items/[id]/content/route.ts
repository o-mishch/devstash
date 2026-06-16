import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getItemContent } from '@/lib/db/items'

export const GET = authedRouteWithParams<IdParam>({}, async ({ userId, params }) => {
  const content = await getItemContent(userId, params.id)
  if (!content) return problem(404, ErrorMessage.ITEM_NOT_FOUND)
  return json(content)
})
