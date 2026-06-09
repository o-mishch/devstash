import { getNotificationRecipientEmail, sendEmail } from '@/lib/infra/resend'
import { buildEmailTemplate } from '@/lib/emails/template-builder'
import billingDisputeAdminHtml from './billing-dispute-admin.html'

interface SendBillingDisputeAdminEmailParams {
  disputeId: string
  chargeId: string | null
  subscriptionId: string | null
  amount: string
  reason: string
}

export async function sendBillingDisputeAdminEmail({
  disputeId,
  chargeId,
  subscriptionId,
  amount,
  reason,
}: SendBillingDisputeAdminEmailParams): Promise<boolean> {
  const to = getNotificationRecipientEmail()
  if (!to) {
    return false
  }

  const bodyHtml = billingDisputeAdminHtml
    .replaceAll('{{DISPUTE_ID}}', disputeId)
    .replaceAll('{{CHARGE_ID}}', chargeId ?? 'unknown')
    .replaceAll('{{SUBSCRIPTION_ID}}', subscriptionId ?? 'none')
    .replaceAll('{{AMOUNT}}', amount)
    .replaceAll('{{REASON}}', reason)
  const html = buildEmailTemplate('Stripe dispute opened', bodyHtml)

  return sendEmail({
    to,
    subject: `Stripe dispute opened — ${disputeId}`,
    html,
    idempotencyKey: `billing-dispute-admin/${disputeId}`,
    operation: 'billing-dispute-admin',
  })
}
