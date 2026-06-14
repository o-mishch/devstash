import 'server-only'
import { ApiResponse } from '@/lib/api/api-response'
import { getProfileData, updateUserEmail } from '@/lib/db/profile'
import { getUserAuthInfoByEmail } from '@/lib/db/users'
import { verifyUserPasswordById } from '@/lib/auth/auth-service'
import { syncStripeCustomerEmailForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { parseOrFail, passwordFieldSchema } from '@/lib/utils/validators'
import type { ApiBody } from '@/types/api'

/**
 * Verifies `password` against the user's stored hash. Returns an error `ApiBody`
 * to short-circuit the route when it does not match, or `null` when valid.
 */
export async function verifyPasswordOrFail(
  userId: string,
  password: string,
  message = 'Incorrect password.',
): Promise<ApiBody<null> | null> {
  const valid = await verifyUserPasswordById(userId, password)
  if (!valid) return ApiResponse.BAD_REQUEST(message)
  return null
}

/**
 * Parses an optional `password` field from a request body and verifies it against the user's hash.
 * Returns an error `ApiBody` (with `requiredMessage` when the field is missing/invalid, or the
 * mismatch error from {@link verifyPasswordOrFail}) to short-circuit the route, or `null` when valid.
 */
export async function verifyPasswordFromBody(
  userId: string,
  password: unknown,
  requiredMessage: string,
): Promise<ApiBody<null> | null> {
  const parsed = parseOrFail(passwordFieldSchema, password)
  if (!parsed.success) return ApiResponse.BAD_REQUEST(requiredMessage)
  return verifyPasswordOrFail(userId, parsed.data)
}

interface ApplyOwnedEmailChangeParams {
  userId: string
  newEmail: string
  notOwnedMessage: string
}

/**
 * Validates that the user owns `newEmail` (primary or a linked account), rejects a collision
 * with another account, and persists the change (DB + Stripe sync + cache invalidation) when it
 * differs from the current email. Returns an error `ApiBody` to short-circuit the route, or `null`
 * once validated (the email was applied, or already current).
 */
export async function applyOwnedEmailChange({
  userId,
  newEmail,
  notOwnedMessage,
}: ApplyOwnedEmailChangeParams): Promise<ApiBody<null> | null> {
  const data = await getProfileData(userId)
  if (!data) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const ownedEmails = new Set<string>([
    data.user.email,
    ...data.user.accounts.flatMap((account) => (account.email ? [account.email] : [])),
  ])
  if (!ownedEmails.has(newEmail)) return ApiResponse.FORBIDDEN(notOwnedMessage)

  const existing = await getUserAuthInfoByEmail(newEmail)
  if (existing && existing.id !== userId) return ApiResponse.CONFLICT('That email is already in use.')

  if (newEmail !== data.user.email) {
    await updateUserEmail(userId, newEmail)
    await syncStripeCustomerEmailForUser(userId, newEmail)
    invalidateProfileCache(userId)
  }
  return null
}
