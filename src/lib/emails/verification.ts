import 'server-only'

import { findUnverifiedUserByEmail } from '@/lib/db/verification'
import { createVerificationToken, verificationRecentlySent } from '@/lib/auth/tokens'
import { sendTokenLinkEmail } from './link-email'
export { emailVerificationEnabled } from '@/lib/utils/auth'

export type VerificationResult = 'sent' | 'failed' | 'skipped'

async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  return sendTokenLinkEmail({
    to,
    token,
    path: 'verify-email',
    subject: 'Verify your DevStash email',
    heading: 'Verify your email',
    intro:
      'Click the button below to verify your DevStash account. This link expires in <strong>24 hours</strong>.',
    cta: 'Verify email',
    disclaimer: "If you didn't create a DevStash account, you can safely ignore this email.",
    keyPrefix: 'verify-email',
    operation: 'verification',
  })
}

export async function resendVerification(email: string): Promise<boolean> {
  const user = await findUnverifiedUserByEmail(email)

  if (!user || user.emailVerified) return false

  // A verification email was already sent within the anti-spam window (a Redis marker with that
  // window as its TTL). The token is hashed at rest, so the original link can't be
  // reproduced — rather than mint a fresh one and defeat the window, treat it as already sent. The
  // recent email is still valid.
  if (await verificationRecentlySent(email)) {
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
