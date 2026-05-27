import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// Use a verified domain in production; onboarding@resend.dev is for testing only
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'DevStash <onboarding@resend.dev>'

export const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  idempotencyKey: string
  logTag: string
}

export async function sendEmail({ to, subject, html, idempotencyKey, logTag }: SendEmailOptions): Promise<boolean> {
  const { error } = await resend.emails.send(
    { from: EMAIL_FROM, to: [to], subject, html },
    { idempotencyKey }
  )

  if (error) {
    console.error(`[${logTag}] failed to send email:`, error.message)
    return false
  }
  return true
}
