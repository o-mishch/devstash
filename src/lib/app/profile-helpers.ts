import 'server-only'
import { getProfileData, updateUserEmail } from '@/lib/db/profile'
import { getUserAuthInfoByEmail, getUserAuthMethods } from '@/lib/db/users'
import { verifyUserPasswordById } from '@/lib/auth/auth-service'
import { syncStripeCustomerEmailForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { parseOrFail, passwordFieldSchema } from '@/lib/utils/validators'
import { ErrorMessage } from '@/lib/api/error-messages'
import type { FailureResult } from '@/lib/api/http'

// These helpers return the shared `FailureResult` descriptor (status + message) instead of throwing,
// which the route handler turns into `problem(...)` — keeping control flow as return values per
// coding-standards (no custom Error subclasses, no instanceof routing). `null` means success.

type AuthMethods = NonNullable<Awaited<ReturnType<typeof getUserAuthMethods>>>

/** Verifies `password` against the user's stored hash. Returns a 400 failure on mismatch, else null. */
export async function verifyPasswordOrFail(
  userId: string,
  password: string,
  message = 'Incorrect password.',
): Promise<FailureResult | null> {
  const valid = await verifyUserPasswordById(userId, password)
  return valid ? null : { status: 400, message }
}

/**
 * Parses an optional `password` field and verifies it against the user's hash. Returns a 400 failure
 * with `requiredMessage` when missing, the mismatch failure from {@link verifyPasswordOrFail}, or
 * null when valid.
 */
export async function verifyPasswordFromBody(
  userId: string,
  password: unknown,
  requiredMessage: string,
): Promise<FailureResult | null> {
  const parsed = parseOrFail(passwordFieldSchema, password)
  if (!parsed.success) return { status: 400, message: requiredMessage }
  return verifyPasswordOrFail(userId, parsed.data)
}

/**
 * Loads the user's auth methods (password + linked accounts). Returns a 401 failure when the row is
 * missing — the session gate already guarantees a session, so this is defensive against a session
 * whose user row no longer exists.
 */
export async function requireAuthMethods(
  userId: string,
): Promise<{ ok: true; user: AuthMethods } | { ok: false; failure: FailureResult }> {
  const user = await getUserAuthMethods(userId)
  if (!user) return { ok: false, failure: { status: 401, message: ErrorMessage.NOT_AUTHENTICATED } }
  return { ok: true, user }
}

interface ApplyOwnedEmailChangeParams {
  userId: string
  newEmail: string
  notOwnedMessage: string
}

/**
 * Validates that the user owns `newEmail` (primary or a linked account), rejects a collision with
 * another account, and persists the change (DB + Stripe sync + cache invalidation) when it differs
 * from the current email. Returns a failure on any check, or null once validated (applied, or
 * already current).
 */
export async function applyOwnedEmailChange({
  userId,
  newEmail,
  notOwnedMessage,
}: ApplyOwnedEmailChangeParams): Promise<FailureResult | null> {
  const data = await getProfileData(userId)
  if (!data) return { status: 401, message: ErrorMessage.NOT_AUTHENTICATED }

  const ownedEmails = new Set<string>([
    data.user.email,
    ...data.user.accounts.flatMap((account) => (account.email ? [account.email] : [])),
  ])
  if (!ownedEmails.has(newEmail)) return { status: 403, message: notOwnedMessage }

  const existing = await getUserAuthInfoByEmail(newEmail)
  if (existing && existing.id !== userId) return { status: 409, message: 'That email is already in use.' }

  if (newEmail !== data.user.email) {
    await updateUserEmail(userId, newEmail)
    await syncStripeCustomerEmailForUser(userId, newEmail)
    invalidateProfileCache(userId)
  }
  return null
}
