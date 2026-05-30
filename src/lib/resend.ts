import { Resend } from 'resend'
import { createLogger } from '@/lib/logger'

const log = createLogger('email')

const resend = new Resend(process.env.RESEND_API_KEY)

// Use a verified domain in production; onboarding@resend.dev is for testing only
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'DevStash <onboarding@resend.dev>'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  idempotencyKey: string
  operation: string
}

export async function sendEmail({ to, subject, html, idempotencyKey, operation }: SendEmailOptions): Promise<boolean> {
  const { error } = await resend.emails.send(
    { from: EMAIL_FROM, to: [to], subject, html },
    { idempotencyKey }
  )

  if (error) {
    log.error(`failed to send "${operation}": ${error.message}`)
    return false
  }
  return true
}
