import 'server-only'

import { sendEmail, type EmailSendResult } from '@/lib/infra/resend'
import { buildEmailTemplate } from '@/lib/emails/template-builder'
import { billingPortalCtaHtml } from './billing-portal-cta'
import billingTrialEndingHtml from './billing-trial-ending.html'

interface SendBillingTrialEndingEmailParams {
  subscriptionId: string
  portalUrl: string
  to: string
}

export async function sendBillingTrialEndingEmail({
  subscriptionId,
  portalUrl,
  to,
}: SendBillingTrialEndingEmailParams): Promise<EmailSendResult> {
  const bodyHtml = `${billingTrialEndingHtml}${billingPortalCtaHtml(portalUrl)}`
  const html = buildEmailTemplate('Your DevStash Pro trial is ending soon', bodyHtml)

  return sendEmail({
    to,
    subject: 'Your DevStash Pro trial is ending soon',
    html,
    idempotencyKey: `billing-trial-ending/${subscriptionId}`,
    operation: 'billing-trial-ending',
  })
}
