import bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { getUserAuthInfoByEmail, getUserAuthMethods, createUser, updateUserPassword, checkProviderAccountExists, createAccount } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/infra/cache'
import type { PendingLinkData } from '@/lib/auth/pending-link'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { consumePasswordResetToken } from '@/lib/auth/tokens'

export type { VerificationResult }

export type ApplyResetResult = 'ok' | 'invalid-token' | 'oauth-only'

/**
 * Validates a user's password.
 * Used by auth actions to prevent importing bcrypt directly in the web layer.
 */
export async function validateUserPassword(email: string, password: string) {
  const user = await getUserAuthInfoByEmail(email)
  if (!user?.password) return null

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
 * Hashes a new password and updates the user's record.
 */
export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await updateUserPassword(userId, hashed)
  invalidateProfileCache(userId)
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
  const existing = await getUserAuthInfoByEmail(email)

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await createUser({
      name,
      email,
      password: hashedPassword,
      emailVerified: verificationEnabled ? undefined : new Date(),
    })

    if (verificationEnabled) {
      return sendRegistrationVerification(email)
    }
  }

  return verificationEnabled ? 'sent' : 'skipped'
}

/**
 * Sends a password reset email if the account has a password (i.e. not OAuth-only).
 * Always resolves without exposing whether the email exists — prevents enumeration.
 */
export async function triggerPasswordReset(email: string): Promise<void> {
  const user = await getUserAuthInfoByEmail(email)
  if (user?.password) {
    await sendPasswordResetRequest(email)
  }
}

/**
 * Consumes a password-reset token and updates the user's password.
 * Returns a result code so callers can map to their own response shape.
 */
export async function applyPasswordReset(
  token: string,
  password: string
): Promise<ApplyResetResult> {
  const record = await consumePasswordResetToken(token)
  if (!record) return 'invalid-token'

  const user = await getUserAuthInfoByEmail(record.email)

  if (!user?.password) return 'oauth-only'

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  await updateUserPassword(user.id, hashed)
  invalidateProfileCache(user.id)

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
  }
}

