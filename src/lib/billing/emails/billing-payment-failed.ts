import { sendEmail } from '@/lib/infra/resend'
import { buildEmailTemplate } from '@/lib/emails/template-builder'
import { billingPortalCtaHtml } from './billing-portal-cta'
import billingPaymentFailedHtml from './billing-payment-failed.html'

interface SendBillingPaymentFailedEmailParams {
  invoiceId: string
  portalUrl: string
  to: string
}

export async function sendBillingPaymentFailedEmail({
  invoiceId,
  portalUrl,
  to,
}: SendBillingPaymentFailedEmailParams): Promise<boolean> {
  const bodyHtml = `${billingPaymentFailedHtml}${billingPortalCtaHtml(portalUrl)}`
  const html = buildEmailTemplate('Update your DevStash billing details', bodyHtml)

  return sendEmail({
    to,
    subject: 'Update your DevStash billing details',
    html,
    idempotencyKey: `billing-payment-failed/${invoiceId}`,
    operation: 'billing-payment-failed',
  })
}
