import { BASE_URL, sendEmail } from '@/lib/resend'
import { createPasswordResetToken } from '@/lib/tokens'
import resetHtml from './password-reset.html'

async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`
  const html = resetHtml.replace('{{RESET_URL}}', resetUrl)

  return sendEmail({
    to,
    subject: 'Reset your DevStash password',
    html,
    idempotencyKey: `password-reset/${token}`,
    logTag: 'password-reset',
  })
}

export async function sendPasswordResetRequest(email: string): Promise<boolean> {
  const token = await createPasswordResetToken(email)
  return sendPasswordResetEmail(email, token)
}
