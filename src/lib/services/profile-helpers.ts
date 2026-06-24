import 'server-only'
import { Prisma } from '@/generated/prisma'
import { buildOwnedEmails, getProfileData, getProfileAccountSummary, updateUserEmail } from '@/lib/db/profile'
import { getUserAuthMethods, isEmailTakenByAnotherUser } from '@/lib/db/users'
import { verifyUserPasswordById } from '@/lib/auth/auth-service'
import { syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { parseOrFail, passwordFieldSchema } from '@/lib/utils/validators'
import { ErrorMessage } from '@/lib/api/error-messages'
import type { FailureResult } from '@/lib/api/http'
import type { ProfileContextResponse } from '@/lib/api/schemas/profile'

// These helpers return the shared `FailureResult` descriptor (status + message) instead of throwing,
// which the route handler turns into `problem(...)` — keeping control flow as return values per
// coding-standards (no custom Error subclasses, no instanceof routing). `null` means success.

type AuthMethods = NonNullable<Awaited<ReturnType<typeof getUserAuthMethods>>>

/**
 * Builds the `GET /profile` JSON shape. Shared by the route handler and the profile page's SSR seed so
 * the network response and the seeded `useProfile` cache are byte-identical (createdAt as ISO string,
 * no Date drift between initialData and a later refetch). Returns null when the user row is missing.
 */
export async function loadProfileContext(userId: string): Promise<ProfileContextResponse | null> {
  const data = await getProfileData(userId)
  if (!data) return null
  const { user, stats } = data
  const { accountTypes, availableEmails } = getProfileAccountSummary(user)
  return {
    name: user.name,
    email: user.email,
    image: user.image,
    hasPassword: user.hasPassword,
    credentialEmail: user.credentialEmail,
    credentialEmailVerified: !!user.credentialEmailVerified,
    isPro: user.isPro,
    createdAt: user.createdAt.toISOString(),
    accounts: user.accounts,
    accountTypes,
    availableEmails,
    verificationDisabled: !outboundEmailEnabled(),
    stats,
  }
}

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
  rawPassword: unknown,
  requiredMessage: string,
): Promise<FailureResult | null> {
  const parsed = parseOrFail(passwordFieldSchema, rawPassword)
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
  profile?: NonNullable<Awaited<ReturnType<typeof getProfileData>>>
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
  profile,
}: ApplyOwnedEmailChangeParams): Promise<FailureResult | null> {
  const data = profile ?? await getProfileData(userId)
  if (!data) return { status: 401, message: ErrorMessage.NOT_AUTHENTICATED }

  const ownedEmails = new Set(buildOwnedEmails(data.user))
  if (!ownedEmails.has(newEmail)) return { status: 403, message: notOwnedMessage }

  if (newEmail === data.user.email) return null

  if (await isEmailTakenByAnotherUser(userId, newEmail)) {
    return { status: 409, message: 'That email is already in use.' }
  }

  try {
    await updateUserEmail(userId, newEmail)
  } catch (error) {
    // TOCTOU backstop: a concurrent claim on User.email (@unique) surfaces as P2002.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 409, message: 'That email is already in use.' }
    }
    throw error
  }
  // Resilient: the email change is committed; a Stripe outage must not 500 it.
  await syncStripeCustomerEmailForUserSafe(userId, newEmail)
  invalidateProfileCache(userId)
  return null
}
