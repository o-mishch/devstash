import bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { getUserAuthInfoByEmail, getUserAuthMethods, createUser, updateUserPassword, setPasswordAndVerifyEmail, findUserByAnyEmail, checkProviderAccountExists, createAccount } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import type { PendingLinkData } from '@/lib/auth/pending-link'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  resendVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { sendSecurityNotification } from '@/lib/emails/security-notification'
import { consumePasswordResetToken } from '@/lib/auth/tokens'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'auth-service' })

export type { VerificationResult }

export type ApplyResetResult = 'ok' | 'invalid-token'

// Fixed throwaway hash used to equalize login timing on the no-user / OAuth-only branch (Case 9), so
// a fast response can't reveal account non-existence. Never matches a real password.
const DUMMY_PASSWORD_HASH = '$2b$12$/aPGheK5yMwWRHblAh2yH.yldP9ajZcNbVAPj.ph67Gnnad6drare'

/**
 * Validates a user's password.
 * Used by auth actions to prevent importing bcrypt directly in the web layer.
 */
export async function validateUserPassword(email: string, password: string) {
  const user = await getUserAuthInfoByEmail(email)
  if (!user?.password) {
    // Constant-time: run a dummy compare so a missing user / OAuth-only account takes comparable
    // time to a wrong password — timing no longer distinguishes them. (Case 9)
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
 * (the user already has a working, verified credential login). Notifies the owner. (Case 7)
 */
export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await updateUserPassword(userId, hashed)
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'password-changed')
}

/**
 * Sets an initial password for an authenticated user who has none (in-app "Set password"). Because
 * OAuth sign-ups leave `emailVerified` null, this also marks the email verified — the user is
 * authenticated and selected an owned email, which is proof enough — otherwise the new credential
 * login would be blocked by `authorize`. Notifies the owner. (Case 1 authenticated twin, Case 7)
 */
export async function setInitialUserPassword(userId: string, newPassword: string): Promise<void> {
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await setPasswordAndVerifyEmail(userId, hashed)
  invalidateProfileCache(userId)
  void sendSecurityNotification(userId, 'password-set')
}

/**
 * Creates a new user account and triggers email verification if enabled.
 * Silently mirrors a successful result for existing emails — prevents enumeration.
 */
export async function registerUser(
  name: string,
  email: string,
  password: string
): Promise<VerificationResult> {
  const verificationEnabled = emailVerificationEnabled()
  // Resolve by any owned email (primary or a linked Account.email) so we never create a duplicate
  // User whose email collides with an existing account's secondary address. (Case 4)
  const existing = await findUserByAnyEmail(email)

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await createUser({
      name,
      email,
      password: hashedPassword,
      emailVerified: verificationEnabled ? undefined : new Date(),
    })
    log.info({ verificationEnabled }, 'register new user')

    if (verificationEnabled) {
      return sendRegistrationVerification(email)
    }

    return 'skipped'
  }

  // Email already belongs to an account. Mirror a successful response in every branch to prevent
  // account enumeration; the email we actually send (if any) always targets the account's PRIMARY
  // email, never the typed address — so a secondary-email entry leaks nothing.
  if (!existing.password) {
    // OAuth-only account → send the unified "set your password" email (reset-token flow). The link
    // proves ownership and sets the password; the typed password is discarded. Independent of
    // DISABLE_EMAIL_VERIFICATION. (Case 3 / Case 4)
    log.info({ userId: existing.id }, 'register over OAuth-only account — sending set-password email')
    await sendPasswordResetRequest(existing.email)
  } else if (verificationEnabled && !existing.emailVerified) {
    // With password but unverified → resend the verification link so the owner can finish signing up.
    log.info({ userId: existing.id }, 'register re-attempt on unverified email — resending verification')
    await resendVerification(existing.email)
  } else {
    // With password and verified → neutral no-op.
    log.info({ userId: existing.id, verified: !!existing.emailVerified }, 'register re-attempt on existing email — no email sent')
  }

  return verificationEnabled ? 'sent' : 'skipped'
}

/**
 * Sends a password-reset / set-password email for ANY existing account — including OAuth-only ones
 * (which gain a credential login by completing the flow). The user may type any email they own
 * (primary or a linked Account.email); the token + email always target the account's PRIMARY email,
 * so a secondary-email entry only ever reaches the legitimate inbox. Always resolves without
 * exposing whether the email exists — prevents enumeration. (Cases 1, 2)
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
 * the owner. Returns a result code so callers can map to their own response shape. (Cases 1, 7)
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

  // Always set the password; also mark the email verified when it's still null (the reset link proves
  // ownership). Both helpers share the (userId, hashed) signature. (Case 1)
  const setPassword = user.emailVerified ? updateUserPassword : setPasswordAndVerifyEmail
  await setPassword(user.id, hashed)
  invalidateProfileCache(user.id)
  // `hadPassword` picks set-vs-reset copy independently of the verify branch. The only divergent case
  // (no password but already verified → 'password-reset') is unreachable: OAuth sign-ups leave
  // `emailVerified` null, so a no-password+verified row doesn't occur.
  void sendSecurityNotification(user.id, hadPassword ? 'password-reset' : 'password-set')

  return 'ok'
}

export async function linkPendingAccount(userId: string, pending: PendingLinkData) {
  const alreadyLinked = await checkProviderAccountExists(pending.provider, pending.providerAccountId)

  if (!alreadyLinked) {
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
    invalidateProfileCache(userId)
    void sendSecurityNotification(userId, 'method-linked')
  }
}

