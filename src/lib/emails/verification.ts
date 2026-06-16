import { findLatestVerificationToken, TOKEN_TTL_MS } from '@/lib/db/tokens'
import { findUnverifiedUserByEmail } from '@/lib/db/verification'
import { sendEmail } from '@/lib/infra/resend'
import { createVerificationToken } from '@/lib/auth/tokens'
import { getBaseUrl } from '@/lib/utils/url'
import { buildEmailTemplate } from './template-builder'
import verificationHtml from './verification.html'

const RATE_LIMIT_MS = 55 * 60 * 1000

export const emailVerificationEnabled = () =>
  process.env.DISABLE_EMAIL_VERIFICATION !== 'true'

export type VerificationResult = 'sent' | 'failed' | 'skipped'

async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  const verifyUrl = `${getBaseUrl()}/verify-email?token=${token}`
  const bodyHtml = verificationHtml.replace('{{VERIFY_URL}}', verifyUrl)
  const html = buildEmailTemplate('Verify your DevStash email', bodyHtml)

  return sendEmail({
    to,
    subject: 'Verify your DevStash email',
    html,
    idempotencyKey: `verify-email/${token}`,
    operation: 'verification',
  })
}

export async function resendVerification(email: string): Promise<boolean> {
  const user = await findUnverifiedUserByEmail(email)

  if (!user || user.emailVerified) return false

  const existing = await findLatestVerificationToken(email)

  const tokenCreatedAt = existing ? existing.expires.getTime() - TOKEN_TTL_MS : 0
  const isTokenFresh = !!existing && Date.now() - tokenCreatedAt < RATE_LIMIT_MS

  // A verification email was already sent within the rate-limit window. The stored token is hashed
  // (Case 8), so the original link can't be reproduced — rather than mint a fresh one (which would
  // defeat the anti-spam window), treat it as already sent. The recent email is still valid.
  if (isTokenFresh) {
    return true
  }

  const token = await createVerificationToken(email)
  return sendVerificationEmail(email, token)
}

export async function sendRegistrationVerification(email: string): Promise<VerificationResult> {
  const token = await createVerificationToken(email)
  const sent = await sendVerificationEmail(email, token)
  return sent ? 'sent' : 'failed'
}
