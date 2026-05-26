import { resend, EMAIL_FROM, BASE_URL } from '@/lib/resend'
import { createPasswordResetToken } from '@/lib/tokens'
import resetHtml from './password-reset.html'

async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`
  const html = resetHtml.replace('{{RESET_URL}}', resetUrl)

  const { error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to: [to],
      subject: 'Reset your DevStash password',
      html,
    },
    { idempotencyKey: `password-reset/${token}` }
  )

  if (error) {
    console.error('[password-reset] failed to send email:', error.message)
    return false
  }

  return true
}

export async function sendPasswordResetRequest(email: string): Promise<boolean> {
  const token = await createPasswordResetToken(email)
  return sendPasswordResetEmail(email, token)
}
