import { authedRouteWithParams, type IdParam } from '@/lib/api/route'
import { json, problem } from '@/lib/api/http'
import { ErrorMessage } from '@/lib/api/error-messages'
import { getItemDetails } from '@/lib/db/items'

export const GET = authedRouteWithParams<IdParam>({}, async ({ userId, params }) => {
  const details = await getItemDetails(userId, params.id)
  if (!details) return problem(404, ErrorMessage.ITEM_NOT_FOUND)
  return json(details)
})
