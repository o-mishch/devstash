import 'server-only'

import { Resend } from 'resend'
import { logger } from '@/lib/infra/pino'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { isLocalEmailEnabled, sendLocalEmail } from '@/lib/infra/email-local'

const log = logger.child({ tag: 'email' })

// Lazy client — constructing `new Resend()` eagerly at module load throws when
// RESEND_API_KEY is unset, which breaks `next build` in environments without
// secrets (e.g. container image builds). Defer construction to first send.
// Mirrors the lazy Stripe adapter in `src/lib/infra/stripe.ts`.
let resendClient: Resend | undefined

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is missing. Please set it in your .env file.')
    }
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

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

  // Local dev: capture mail in Mailpit via SMTP instead of calling Resend.
  // Active only when SMTP_HOST is set (local Secret); never set on Vercel or GCP.
  if (isLocalEmailEnabled()) {
    try {
      await sendLocalEmail({ from: EMAIL_FROM, to, subject, html })
      log.info({ operation, to }, 'Email sent via local SMTP (Mailpit)')
      return 'sent'
    } catch (err) {
      log.error({ operation, to, err }, 'Local SMTP email send failed')
      return 'failed'
    }
  }

  const { error } = await getResendClient().emails.send(
    { from: EMAIL_FROM, to: [to], subject, html },
    { idempotencyKey }
  )

  if (error) {
    log.error({ operation, to, err: error }, 'Email send failed')
    return 'failed'
  }
  return 'sent'
}
