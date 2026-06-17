import 'server-only'

import { Resend } from 'resend'
import { logger } from '@/lib/infra/pino'
import { outboundEmailEnabled } from '@/lib/utils/auth'

const log = logger.child({ tag: 'email' })

const resend = new Resend(process.env.RESEND_API_KEY)

// Use a verified domain in production; onboarding@resend.dev is for testing only
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'DevStash <onboarding@resend.dev>'

/** Extracts the bare address from `Name <email@domain.com>` or returns the input as-is. */
export function parseEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/)
  return (match?.[1] ?? value).trim()
}

/** Recipient for internal billing alerts — same address as EMAIL_FROM. */
export function getNotificationRecipientEmail(): string | null {
  const from = process.env.EMAIL_FROM?.trim()
  if (!from) return null
  const address = parseEmailAddress(from)
  return address || null
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  idempotencyKey: string
  operation: string
}

// Distinguishes a real send from an intentional dev no-op so telemetry never reports a skipped email
// as "sent". Callers that only care "did it not fail" treat `!== 'failed'` as success.
export type EmailSendResult = 'sent' | 'skipped' | 'failed'

export async function sendEmail({ to, subject, html, idempotencyKey, operation }: SendEmailOptions): Promise<EmailSendResult> {
  if (!outboundEmailEnabled()) {
    log.info({ operation, to }, 'Email skipped — outbound email disabled')
    return 'skipped'
  }

  const { error } = await resend.emails.send(
    { from: EMAIL_FROM, to: [to], subject, html },
    { idempotencyKey }
  )

  if (error) {
    log.error({ operation, to, err: error }, 'Email send failed')
    return 'failed'
  }
  return 'sent'
}
