import bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { prisma } from '@/lib/prisma'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { consumePasswordResetToken } from '@/lib/tokens'

export type { VerificationResult }

export type ApplyResetResult = 'ok' | 'invalid-token' | 'oauth-only'

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
  const existing = await prisma.user.findUnique({ where: { email } })

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        emailVerified: verificationEnabled ? undefined : new Date(),
      },
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
  const user = await prisma.user.findUnique({ where: { email }, select: { password: true } })
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

  const user = await prisma.user.findUnique({
    where: { email: record.email },
    select: { id: true, password: true },
  })

  if (!user?.password) return 'oauth-only'

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } })

  return 'ok'
}
