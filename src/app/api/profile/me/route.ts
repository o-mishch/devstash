import { authedRoute } from '@/lib/api/route'
import { json } from '@/lib/api/http'
import { canCreateItem, canCreateCollection } from '@/lib/db/usage'
import { getUserProfile } from '@/lib/db/users'
import { userProfileFlagsSchema } from '@/lib/api/schemas/profile'

export const GET = authedRoute({}, async ({ userId, isPro }) => {
  const [userCanCreateItem, userCanCreateCollection, user] = await Promise.all([
    canCreateItem(userId, isPro),
    canCreateCollection(userId, isPro),
    getUserProfile(userId),
  ])
  // Parse on the way out so the response is gated by the schema (strips anything not in the contract).
  const body = userProfileFlagsSchema.parse({
    isPro,
    canCreateItem: userCanCreateItem,
    canCreateCollection: userCanCreateCollection,
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
  })
  return json(body)
})
