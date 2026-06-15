import 'server-only'
import { ORPCError } from '@orpc/server'
import { getProfileData, updateUserEmail } from '@/lib/db/profile'
import { getUserAuthInfoByEmail, getUserAuthMethods } from '@/lib/db/users'
import { verifyUserPasswordById } from '@/lib/auth/auth-service'
import { syncStripeCustomerEmailForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { parseOrFail, passwordFieldSchema } from '@/lib/utils/validators'
import { ErrorMessage } from '@/lib/api/error-messages'

/**
 * Verifies `password` against the user's stored hash. Throws ORPCError('BAD_REQUEST') when it does
 * not match; resolves when valid.
 */
export async function verifyPasswordOrFail(
  userId: string,
  password: string,
  message = 'Incorrect password.',
): Promise<void> {
  const valid = await verifyUserPasswordById(userId, password)
  if (!valid) throw new ORPCError('BAD_REQUEST', { message })
}

/**
 * Parses an optional `password` field and verifies it against the user's hash. Throws
 * ORPCError('BAD_REQUEST') with `requiredMessage` when missing/invalid, or the mismatch error from
 * {@link verifyPasswordOrFail}; resolves when valid.
 */
export async function verifyPasswordFromBody(
  userId: string,
  password: unknown,
  requiredMessage: string,
): Promise<void> {
  const parsed = parseOrFail(passwordFieldSchema, password)
  if (!parsed.success) throw new ORPCError('BAD_REQUEST', { message: requiredMessage })
  await verifyPasswordOrFail(userId, parsed.data)
}

/**
 * Loads the user's auth methods (password + linked accounts), throwing ORPCError('UNAUTHORIZED')
 * when the row is missing. The `authed` middleware already guarantees a session, so this guard is
 * defensive against a session whose user row no longer exists.
 */
export async function requireAuthMethods(userId: string) {
  const user = await getUserAuthMethods(userId)
  if (!user) throw new ORPCError('UNAUTHORIZED', { message: ErrorMessage.NOT_AUTHENTICATED })
  return user
}

interface ApplyOwnedEmailChangeParams {
  userId: string
  newEmail: string
  notOwnedMessage: string
}

/**
 * Validates that the user owns `newEmail` (primary or a linked account), rejects a collision with
 * another account, and persists the change (DB + Stripe sync + cache invalidation) when it differs
 * from the current email. Throws ORPCError on any failure; resolves once validated (applied, or
 * already current).
 */
export async function applyOwnedEmailChange({
  userId,
  newEmail,
  notOwnedMessage,
}: ApplyOwnedEmailChangeParams): Promise<void> {
  const data = await getProfileData(userId)
  if (!data) throw new ORPCError('UNAUTHORIZED', { message: ErrorMessage.NOT_AUTHENTICATED })

  const ownedEmails = new Set<string>([
    data.user.email,
    ...data.user.accounts.flatMap((account) => (account.email ? [account.email] : [])),
  ])
  if (!ownedEmails.has(newEmail)) throw new ORPCError('FORBIDDEN', { message: notOwnedMessage })

  const existing = await getUserAuthInfoByEmail(newEmail)
  if (existing && existing.id !== userId) throw new ORPCError('CONFLICT', { message: 'That email is already in use.' })

  if (newEmail !== data.user.email) {
    await updateUserEmail(userId, newEmail)
    await syncStripeCustomerEmailForUser(userId, newEmail)
    invalidateProfileCache(userId)
  }
}
