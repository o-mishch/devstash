import { sendEmail } from '@/lib/infra/resend'
import { getBaseUrl } from '@/lib/utils/url'
import { createPasswordResetToken } from '@/lib/auth/tokens'
import { buildEmailTemplate } from './template-builder'
import resetHtml from './password-reset.html'

async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`
  const bodyHtml = resetHtml.replace('{{RESET_URL}}', resetUrl)
  const html = buildEmailTemplate('Reset your DevStash password', bodyHtml)

  return sendEmail({
    to,
    subject: 'Reset your DevStash password',
    html,
    idempotencyKey: `password-reset/${token}`,
    operation: 'password-reset',
  })
}

export async function sendPasswordResetRequest(email: string): Promise<boolean> {
  const token = await createPasswordResetToken(email)
  return sendPasswordResetEmail(email, token)
}
