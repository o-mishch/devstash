import 'server-only'

import { createPasswordResetToken } from '@/lib/auth/tokens'
import { sendTokenLinkEmail } from './link-email'

export async function sendPasswordResetRequest(email: string): Promise<boolean> {
  const token = await createPasswordResetToken(email)
  return sendTokenLinkEmail({
    to: email,
    token,
    path: 'reset-password',
    subject: 'Reset your DevStash password',
    heading: 'Reset your password',
    intro:
      'Click the button below to reset your DevStash password. This link expires in <strong>1 hour</strong>.',
    cta: 'Reset password',
    disclaimer: "If you didn't request a password reset, you can safely ignore this email.",
    keyPrefix: 'password-reset',
    operation: 'password-reset',
  })
}
