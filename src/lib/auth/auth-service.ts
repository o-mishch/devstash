import 'server-only'

import bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { Prisma } from '@/generated/prisma'
import { getUserAuthInfoByEmail, getUserAuthMethods, createCredentialUser, updateUserPassword, setPasswordAndVerifyEmail, bootstrapCredentialLogin, findUserByAnyEmail, checkProviderAccountExists, createAccount, setCredentialEmailLogin, changeCredentialEmail, isEmailTakenByAnotherUser } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { syncStripeCustomerEmailForUserSafe } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import type { PendingLinkData } from '@/lib/auth/pending-link'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { sendRegistrationVerification, type VerificationResult } from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { sendCredentialEmailLink } from '@/lib/emails/credential-email'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { consumePasswordResetToken, consumeCredentialEmailToken, createCredentialEmailToken, deleteCredentialEmailToken, peekCredentialEmailPayload, restoreCredentialEmailToken } from '@/lib/auth/tokens'
import { checkRateLimit, type RateLimitKey } from '@/lib/infra/rate-limit'
import { MAX_PASSWORD_LENGTH } from '@/lib/utils/validators'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'auth-service' })

export type CredentialLoginGuardFailure = 'password-too-long' | 'ip-rate-limited'

export interface CredentialLoginGuardResult {
  ok: boolean
  reason?: CredentialLoginGuardFailure
  retryAfter?: number
}

export function isLoginPasswordTooLong(password: string): boolean {
  return password.length > MAX_PASSWORD_LENGTH
}

/**
 * Pre-bcrypt guards shared by the login route and NextAuth `authorize`. The two layers pass different
 * per-IP buckets (`loginIP` for the route, `loginAuthorizeIP` for authorize) so one logical /login —
 * which hits the route guard and then authorize via signIn — isn't charged twice against one budget.
 */
export async function assertCredentialLoginAllowed(
  ip: string,
  password: string,
  ipRateLimitKey: Extract<RateLimitKey, 'loginIP' | 'loginAuthorizeIP'> = 'loginIP',
): Promise<CredentialLoginGuardResult> {
  if (isLoginPasswordTooLong(password)) {
    return { ok: false, reason: 'password-too-long', retryAfter: 0 }
  }
  const { success, retryAfter } = await checkRateLimit(ipRateLimitKey, ip)
  if (!success) {
    return { ok: false, reason: 'ip-rate-limited', retryAfter }
  }
  return { ok: true }
}

export type { VerificationResult }

// Registration outcome — `VerificationResult` plus the dev-only rejection when an Email & Password
// sign-up targets an existing account's email and there is no verification link to prove ownership.
export type RegisterResult = VerificationResult | 'email-in-use'

export interface RegisterOutcome {
  result: RegisterResult
  sendEmail?: () => Promise<unknown>
}

export type ApplyResetResult = 'ok' | 'invalid-token'
export type ConfirmCredentialEmailResult = 'ok' | 'invalid-token' | 'email-in-use' | 'password-required'
export type RequestCredentialEmailResult = 'sent' | 'activated' | 'email-in-use' | 'password-required' | 'send-failed' | 'not-found'

export interface RequestCredentialEmailOutcome {
  result: RequestCredentialEmailResult
  sendEmail?: () => Promise<unknown>
}

// Fixed throwaway hash used to equalize login timing on the no-user / OAuth-only branch, so a fast
// response can't reveal account non-existence. Never matches a real password.
const DUMMY_PASSWORD_HASH = '$2b$12$/aPGheK5yMwWRHblAh2yH.yldP9ajZcNbVAPj.ph67Gnnad6drare'

/**
 * Validates a user's password.
 * Used by auth actions to prevent importing bcrypt directly in the web layer.
 */
export async function validateUserPassword(email: string, password: string) {
  if (isLoginPasswordTooLong(password)) return null

  const user = await getUserAuthInfoByEmail(email)
  if (!user?.password) {
    // Constant-time: run a dummy compare so a missing user / OAuth-only account takes comparable
    // time to a wrong password — timing no longer distinguishes them.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
    return null
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return null

  return user
}

/**
 * Verifies a user's password by their ID.
 */
export async function verifyUserPasswordById(userId: string, password: string): Promise<boolean> {
  const user = await getUserAuthMethods(userId)
  if (!user?.password) return false

  return bcrypt.compare(password, user.password)
}

/**
 * Hashes a new password and updates the user's record. Used by the in-app change-password path
 * (the user already has a working, verified credential login). Notifies the owner.
 */
export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await updateUserPassword(userId, hashed)
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'password-changed')
}

/**
 * Creates a new user account and triggers email verification if enabled.
 * Silently mirrors a successful result for existing emails — prevents enumeration.
 */
export async function registerUser(
  name: string,
  email: string,
  password: string
): Promise<RegisterOutcome> {
  const verificationEnabled = outboundEmailEnabled()
  // Resolve by any owned email (primary or a linked Account.email) so we never create a duplicate
  // User whose email collides with an existing account's secondary address.
  let existing = await findUserByAnyEmail(email)

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const verifiedAt = verificationEnabled ? undefined : new Date()
    // Transactional create with an in-txn collision re-check (+ P2002 backstop) — a concurrent sign-up
    // or credential-email confirm can claim this address between the resolve above and the write.
    const created = await createCredentialUser({
      name,
      email,
      password: hashedPassword,
      emailVerified: verifiedAt,
      // Email & Password registration IS the credential login: store the typed address as the
      // credential-login email, and mirror it into the (never-empty) primary `email` as the default.
      // `password` therefore belongs to this credential email. The two fields stay in lockstep until
      // the user later picks a different default after linking an OAuth account.
      credentialEmail: email,
      credentialEmailVerified: verifiedAt,
    })

    if (created === 'ok') {
      log.info({ verificationEnabled }, 'register new user')
      if (verificationEnabled) {
        return {
          result: 'sent',
          sendEmail: () => sendRegistrationVerification(email),
        }
      }
      return { result: 'skipped' }
    }

    // Lost the race: the address was claimed between our resolve and create. Re-resolve and fall
    // through to the enumeration-safe existing-account handling below.
    log.info({}, 'register lost create race — re-resolving existing account')
    existing = await findUserByAnyEmail(email)
    // The collision was against an address we can't resolve as owned (e.g. another user's still
    // -unverified credentialEmail) — reject safely without creating a duplicate or leaking.
    if (!existing) return { result: verificationEnabled ? 'sent' : 'email-in-use' }
  }

  // Email already belongs to an account. Mirror a successful response in every branch to prevent
  // account enumeration; the email we actually send (if any) always targets the account's PRIMARY
  // email, never the typed address — so a secondary-email entry leaks nothing.
  if (!verificationEnabled) {
    // DISABLE_EMAIL_VERIFICATION: there's no link to prove ownership, and re-using an existing email as a
    // fresh sign-up is meaningless — report it as in use for EVERY existing account (consistent, and it
    // stops silently discarding the typed password). Dev-only; enumeration is not a concern with
    // verification off.
    log.info({ userId: existing.id }, 'register over existing account rejected — verification disabled')
    return { result: 'email-in-use' }
  }

  // Verification on: mirror a successful 'sent' in every branch (enumeration-safe), sending whatever
  // email fits the account's state — always to the account's PRIMARY inbox, never the typed address.
  if (!existing.password || !existing.emailVerified) {
    // OAuth-only, or has a password but unverified: nudge toward password reset either way —
    // confirming it proves ownership, sets/changes the password, AND marks emailVerified when null
    // (applyPasswordReset), so a re-registration attempt on an incomplete account resolves both
    // problems in one link. A plain verification-resend would leave the owner unable to log in if
    // they don't remember the password from the abandoned attempt either.
    log.info({ userId: existing.id }, 'register re-attempt on incomplete account — sending password-reset link')
    return {
      result: 'sent',
      sendEmail: () => sendPasswordResetRequest(existing.email),
    }
  } else {
    // Has a password and verified → neutral no-op.
    log.info({ userId: existing.id }, 'register re-attempt on existing verified email — no email sent')
    return { result: 'sent' }
  }
}

/**
 * Sends a password-reset / set-password email for ANY existing account — including OAuth-only ones
 * (which gain a credential login by completing the flow). The user may type any email they own
 * (primary or a linked Account.email); the token + email always target the account's PRIMARY email,
 * so a secondary-email entry only ever reaches the legitimate inbox. Always resolves without
 * exposing whether the email exists — prevents enumeration.
 */
export async function triggerPasswordReset(email: string): Promise<void> {
  const user = await findUserByAnyEmail(email)
  if (user) {
    await sendPasswordResetRequest(user.email)
  }
}

/**
 * Consumes a password-reset token and sets the user's password. Works for OAuth-only accounts (no
 * existing password) too — completing the link bootstraps a credential login. Marks `emailVerified`
 * when null (the reset link, sent to the primary inbox, proves ownership); this also fixes the
 * pre-existing gap where an unverified credentials user could reset but still not log in. Notifies
 * the owner. Returns a result code so callers can map to their own response shape.
 */
export async function applyPasswordReset(
  token: string,
  password: string
): Promise<ApplyResetResult> {
  const record = await consumePasswordResetToken(token)
  if (!record) return 'invalid-token'

  const user = await getUserAuthInfoByEmail(record.email)
  if (!user) return 'invalid-token'

  const hadPassword = !!user.password
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)

  if (!hadPassword) {
    // First credential login on an existing (typically OAuth) account: the link proved ownership of the
    // primary email, so it becomes the credential-login email too (`email == credentialEmail`) — merging
    // the Email & Password login into the account.
    const bootstrapped = await bootstrapCredentialLogin(user.id, hashed, user.email)
    if (bootstrapped === 'in-use') {
      // Another account already holds this address as a verified credential email — merging would create
      // two login paths to the same address. Fail safe; the user can retry once the conflict is resolved.
      log.info({ userId: user.id }, 'password reset bootstrap rejected — credential email taken by another account')
      return 'invalid-token'
    }
  } else if (!user.emailVerified) {
    // Existing but unverified credential login → set the password and verify the email (which already
    // equals the credential email, so the two stay in lockstep).
    await setPasswordAndVerifyEmail(user.id, hashed)
  } else {
    await updateUserPassword(user.id, hashed)
  }
  invalidateProfileCache(user.id)
  // `!hadPassword` = a first credential login was just bootstrapped into an existing account, or an
  // OAuth account completed forgot-password, so the "sign-in email added" copy fits better than generic
  // "password set". `hadPassword` is a genuine reset.
  void sendSecurityNotification(user.id, hadPassword ? 'password-reset' : 'credential-email-added')

  return 'ok'
}

/**
 * Requests a credential (Email & Password) login email change for an authenticated user, keyed by
 * `credentialEmail` — `User.email` / `emailVerified` are never written by this flow. The operation is
 * an ADD when the user has no password yet, or a CHANGE (re-point) when they already do; the user's
 * current password state is the source of truth (it mirrors how the profile UI gates the two dialogs).
 *
 * Verification enabled: a single-use token (carrying the add/change mode) is issued and the link
 * emailed to the address (proof of ownership) — nothing changes until confirmed. Enumeration-safe: if
 * the address is already used by another user (primary, credential, or linked OAuth email) we
 * silently do nothing and resolve 'sent'.
 *
 * Verification disabled: the link is skipped and the change applies immediately — ADD sets the
 * password collected up front via `setCredentialEmailLogin`, CHANGE re-points via `changeCredentialEmail`
 * (no password needed). Both are DB-unique-constraint authoritative (TOCTOU / P2002 safe). Returns
 * 'password-required' when an ADD has no password, 'email-in-use' on a collision, else 'activated'.
 */
export async function requestCredentialEmail(
  userId: string,
  email: string,
  password?: string,
): Promise<RequestCredentialEmailOutcome> {
  const methods = await getUserAuthMethods(userId)
  // Already has a password → this is a re-point of the existing sign-in email, not a first-time add.
  const isChange = !!methods?.password

  if (outboundEmailEnabled()) {
    // Only a collision with ANOTHER user blocks the request; the caller's own owned address is allowed
    // (the confirm link then promotes it to a credential login), so it's never a silent dead-end.
    const takenByAnother = await isEmailTakenByAnotherUser(userId, email)
    if (!takenByAnother) {
      return {
        result: 'sent',
        sendEmail: async () => {
          let token: string
          try {
            token = await createCredentialEmailToken(userId, email, isChange ? 'change' : 'add')
          } catch (err) {
            log.error({ userId, isChange, err }, 'credential-email token creation failed')
            return
          }
          try {
            const sent = await sendCredentialEmailLink(email, token, isChange ? 'change' : 'add')
            if (!sent) {
              log.error({ userId, isChange }, 'credential-email confirmation send failed')
              await deleteCredentialEmailToken(token)
            }
          } catch (err) {
            log.error({ userId, isChange, err }, 'credential-email confirmation send failed')
            await deleteCredentialEmailToken(token)
          }
        }
      }
    }
    log.info({ userId, isChange, takenByAnother }, 'credential-email request handled')
    return { result: 'sent' }
  }

  // DISABLE_EMAIL_VERIFICATION: skip the link and apply immediately.
  if (isChange) {
    const result = await changeCredentialEmail(userId, email)
    if (result.status === 'in-use') {
      log.info({ userId }, 'credential-email instant change rejected — address already in use')
      return { result: 'email-in-use' }
    }
    if (result.status === 'not-found') {
      // The authenticated user's row was deleted mid-request (admin delete, replication lag, tests) —
      // a controlled 'not-found' the route maps to 401 beats a 500 on a since-invalid session.
      log.info({ userId }, 'credential-email instant change: user no longer exists')
      return { result: 'not-found' }
    }
    // The primary email moved with the credential email (in-sync account) → keep Stripe aligned
    // resiliently because the change is already committed.
    if (result.emailMoved) await syncStripeCustomerEmailForUserSafe(userId, email)
    invalidateProfileCache(userId)
    // Alert the OLD sign-in address because it just lost its login, not the moved-to primary.
    void sendSecurityNotification(userId, 'credential-email-changed', { to: result.previousLoginEmail ?? undefined })
    log.info({ userId, emailMoved: result.emailMoved }, 'credential-email changed instantly (verification disabled)')
    return { result: 'activated' }
  }

  if (!password) return { result: 'password-required' }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const result = await setCredentialEmailLogin(userId, hashed, email)
  if (result === 'in-use') {
    log.info({ userId }, 'credential-email instant activation rejected — address already in use')
    return { result: 'email-in-use' }
  }
  if (result === 'not-found') {
    // The authenticated user's row was deleted mid-request — return a controlled 'not-found' (→ 401)
    // rather than a 500 on a session that is no longer valid.
    log.info({ userId }, 'credential-email instant activation: user no longer exists')
    return { result: 'not-found' }
  }

  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'credential-email-added')
  log.info({ userId }, 'credential-email activated instantly (verification disabled)')
  return { result: 'activated' }
}

/**
 * Confirms a credential-login email: consumes the single-use token, then writes via the transactional db
 * helpers (DB unique constraint authoritative — see them for the TOCTOU / P2002 rationale). The operation
 * is derived from the user's CURRENT password state, not just the token's `mode` (which only drove the
 * confirm page's form), so a token that went stale between request and confirm stays safe:
 *  - has a password now → re-point `credentialEmail` only via `changeCredentialEmail` (existing password
 *    never clobbered; primary `email` moves only when in-sync). Notifies 'credential-email-changed'.
 *  - no password yet → set password + credentialEmail + verified via `setCredentialEmailLogin` (requires a
 *    password → 'password-required'/422 otherwise). Notifies 'credential-email-added'.
 * 'in-use' → 'email-in-use' (→ 409). On success, notifies the account owner at their PRIMARY email, never
 * the new address. (Gaps A, C; item 3)
 */
export async function confirmCredentialEmail(
  token: string,
  password?: string,
): Promise<ConfirmCredentialEmailResult> {
  const payload = await peekCredentialEmailPayload(token)
  if (!payload) return 'invalid-token'

  const consumed = await consumeCredentialEmailToken(token)
  if (!consumed) return 'invalid-token'

  // Fetch after consuming the single-use token to determine the user's password state and write paths.
  const methods = await getUserAuthMethods(payload.userId)
  if (!methods) {
    log.info({ userId: payload.userId }, 'credential-email confirm rejected — user no longer exists')
    return 'invalid-token'
  }

  // Already has a credential login → re-point the credential email only; never touch the password (a
  // stale 'add' confirmed after the account gained a password lands here and re-points, not clobbers).
  if (methods.password) {
    const result = await changeCredentialEmail(payload.userId, payload.email)
    if (result.status === 'in-use') {
      log.info({ userId: payload.userId }, 'credential-email change confirm rejected — address already in use')
      return 'email-in-use'
    }
    if (result.status === 'not-found') {
      log.info({ userId: payload.userId }, 'credential-email change confirm rejected — user no longer exists')
      return 'invalid-token'
    }
    // The primary email moved with the credential email (in-sync account) → keep Stripe aligned
    // resiliently: the change is committed and the single-use token already spent, so a Stripe outage
    // must not 500 and strand it with no retry.
    if (result.emailMoved) await syncStripeCustomerEmailForUserSafe(payload.userId, payload.email)
    invalidateProfileCache(payload.userId)
    log.info({ userId: payload.userId, emailMoved: result.emailMoved }, 'credential-email change confirmed')
    // Alert the OLD sign-in address because it just lost its login, not the moved-to primary.
    void sendSecurityNotification(payload.userId, 'credential-email-changed', { to: result.previousLoginEmail ?? undefined })
    return 'ok'
  }

  // No password yet → set password + credentialEmail + verified via `setCredentialEmailLogin`.
  // Requires a password; if missing, restore the token so the single-use link is NOT burned.
  if (!password) {
    await restoreCredentialEmailToken(token, payload)
    log.info({ userId: payload.userId }, 'credential-email confirm rejected — password required')
    return 'password-required'
  }
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const result = await setCredentialEmailLogin(payload.userId, hashed, payload.email)
  if (result === 'in-use') {
    log.info({ userId: payload.userId }, 'credential-email confirm rejected — address already in use')
    return 'email-in-use'
  }
  if (result === 'not-found') {
    // User was deleted after the token was issued — the spent token can't bootstrap a gone account.
    log.info({ userId: payload.userId }, 'credential-email confirm rejected — user no longer exists')
    return 'invalid-token'
  }

  invalidateProfileCache(payload.userId)
  log.info({ userId: payload.userId }, 'credential-email confirmed')
  void sendSecurityNotification(payload.userId, 'credential-email-added')
  return 'ok'
}

export async function linkPendingAccount(userId: string, pending: PendingLinkData) {
  const alreadyLinked = await checkProviderAccountExists(pending.provider, pending.providerAccountId)

  if (alreadyLinked) {
    log.info({ userId, provider: pending.provider, providerAccountId: pending.providerAccountId }, 'linkPendingAccount skipped — account already linked')
    return
  }

  try {
    await createAccount({
      userId,
      type: pending.type,
      provider: pending.provider,
      providerAccountId: pending.providerAccountId,
      email: pending.providerEmail,
      access_token: pending.access_token,
      refresh_token: pending.refresh_token,
      expires_at: pending.expires_at,
      token_type: pending.token_type,
      scope: pending.scope,
      id_token: pending.id_token,
      session_state: pending.session_state,
    })
  } catch (error) {
    // P2002: concurrent request won the unique-constraint race — treat as idempotent success
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      log.info({ userId, provider: pending.provider }, 'linkPendingAccount race — account already created by concurrent request')
      return
    }
    throw error
  }
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'method-linked')
}
