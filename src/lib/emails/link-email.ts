import 'server-only'

import { sendEmail } from '@/lib/infra/resend'
import { getBaseUrl } from '@/lib/utils/url'
import { buildEmailTemplate } from './template-builder'
import linkEmailHtml from './link-email.html'

interface TokenLinkEmailOptions {
  to: string
  token: string
  /** Path the token link points at, e.g. `verify-email` → `${baseUrl}/verify-email?token=…`. */
  path: string
  subject: string
  heading: string
  /** Body sentence; may contain inline HTML (e.g. `<strong>1 hour</strong>`). */
  intro: string
  cta: string
  disclaimer: string
  /** Idempotency-key prefix (not always equal to `operation`, e.g. `verify-email`/`verification`). */
  keyPrefix: string
  operation: string
}

/**
 * Sends a transactional "click this link" email (verify / reset / confirm). Every such email is the
 * same shape — a token link plus per-flow copy — so they all funnel through this one sender.
 */
export async function sendTokenLinkEmail({
  to,
  token,
  path,
  subject,
  heading,
  intro,
  cta,
  disclaimer,
  keyPrefix,
  operation,
}: TokenLinkEmailOptions): Promise<boolean> {
  const url = `${getBaseUrl()}/${path}?token=${token}`
  const bodyHtml = linkEmailHtml
    .replace('{{HEADING}}', heading)
    .replace('{{INTRO}}', intro)
    .replace('{{URL}}', url)
    .replace('{{CTA}}', cta)
    .replace('{{DISCLAIMER}}', disclaimer)

  // Auth callers only branch on success-vs-failure; an intentional dev skip is "handled", not failed.
  return (await sendEmail({
    to,
    subject,
    html: buildEmailTemplate(subject, bodyHtml),
    idempotencyKey: `${keyPrefix}/${token}`,
    operation,
  })) !== 'failed'
}
