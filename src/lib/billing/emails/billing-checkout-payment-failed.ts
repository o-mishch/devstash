import 'server-only'

import { sendEmail, type EmailSendResult } from '@/lib/infra/resend'
import { buildEmailTemplate } from '@/lib/emails/template-builder'
import { billingPortalCtaHtml } from './billing-portal-cta'
import billingCheckoutPaymentFailedHtml from './billing-checkout-payment-failed.html'

interface SendBillingCheckoutPaymentFailedEmailParams {
  sessionId: string
  portalUrl: string
  to: string
}

export async function sendBillingCheckoutPaymentFailedEmail({
  sessionId,
  portalUrl,
  to,
}: SendBillingCheckoutPaymentFailedEmailParams): Promise<EmailSendResult> {
  const bodyHtml = `${billingCheckoutPaymentFailedHtml}${billingPortalCtaHtml(portalUrl)}`
  const html = buildEmailTemplate('Your DevStash Pro checkout payment failed', bodyHtml)

  return sendEmail({
    to,
    subject: 'Your DevStash Pro checkout payment failed',
    html,
    idempotencyKey: `billing-checkout-payment-failed/${sessionId}`,
    operation: 'billing-checkout-payment-failed',
  })
}
