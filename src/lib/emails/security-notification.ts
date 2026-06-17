import 'server-only'

import { sendEmail } from '@/lib/infra/resend'
import { getUserById } from '@/lib/db/users'
import { getBaseUrl } from '@/lib/utils/url'
import { logger } from '@/lib/infra/pino'
import { buildEmailTemplate } from './template-builder'
import securityHtml from './security-notification.html'

const log = logger.child({ tag: 'security-notification' })

// Security-relevant account changes that warrant notifying the owner (OWASP best practice). Always
// sent to the account's primary `User.email`, never a secondary — so it leaks nothing new.
export type SecurityEventType =
  | 'password-changed'
  | 'password-reset'
  | 'password-removed'
  | 'method-linked'
  | 'method-unlinked'
  | 'credential-email-added'
  | 'credential-email-changed'

interface SecurityEventCopy {
  subject: string
  heading: string
  message: string
}

const EVENT_COPY: Record<SecurityEventType, SecurityEventCopy> = {
  'password-changed': {
    subject: 'Your DevStash password was changed',
    heading: 'Password changed',
    message: 'The password on your DevStash account was just changed.',
  },
  'password-reset': {
    subject: 'Your DevStash password was reset',
    heading: 'Password reset',
    message: 'The password on your DevStash account was just reset.',
  },
  'password-removed': {
    subject: 'Your DevStash password was removed',
    heading: 'Password removed',
    message: 'The password on your DevStash account was just removed. You can still sign in with your linked sign-in methods.',
  },
  'method-linked': {
    subject: 'A new sign-in method was linked to your DevStash account',
    heading: 'Sign-in method linked',
    message: 'A new sign-in method was just linked to your DevStash account.',
  },
  'method-unlinked': {
    subject: 'A sign-in method was removed from your DevStash account',
    heading: 'Sign-in method removed',
    message: 'A sign-in method was just removed from your DevStash account.',
  },
  'credential-email-added': {
    subject: 'A new sign-in email was added to your DevStash account',
    heading: 'Sign-in email added',
    message: 'A new email-and-password sign-in was just confirmed for your DevStash account. You can now sign in with that email address in addition to your existing sign-in methods.',
  },
  'credential-email-changed': {
    subject: 'Your DevStash sign-in email was changed',
    heading: 'Sign-in email changed',
    message: 'The email you use for email-and-password sign-in on your DevStash account was just changed. Your password and your other sign-in methods are unchanged.',
  },
}

interface SecurityNotificationOptions {
  // Override the recipient instead of resolving the account's CURRENT primary email. Used when the
  // event moved the primary (a credential sign-in email change) and the alert must reach the OLD
  // sign-in address per OWASP email-change guidance — never the now-current (possibly attacker-chosen)
  // address. Callers pass an address read from the user's own row, so it is always owned.
  to?: string
}

/**
 * Fire-and-forget notification to the account owner. Never throws and never blocks the operation —
 * a send failure is logged, consistent with the rest of our email handling. Resolves the primary
 * email itself (so callers only need the userId) unless an explicit `to` recipient is given.
 */
export async function sendSecurityNotification(
  userId: string,
  event: SecurityEventType,
  options: SecurityNotificationOptions = {},
): Promise<void> {
  try {
    const recipient = options.to ?? (await getUserById(userId))?.email
    if (!recipient) return

    const { subject, heading, message } = EVENT_COPY[event]
    const bodyHtml = securityHtml
      .replace('{{HEADING}}', heading)
      .replace('{{MESSAGE}}', message)
      .replace('{{SETTINGS_URL}}', `${getBaseUrl()}/profile`)
    const html = buildEmailTemplate(subject, bodyHtml)

    await sendEmail({
      to: recipient,
      subject,
      html,
      // Intentionally per-call unique: each security event is a distinct occurrence the owner should
      // see, so we do NOT dedupe repeats the way token-keyed emails (verify/reset) do.
      idempotencyKey: `security/${event}/${userId}/${Date.now()}`,
      operation: 'security-notification',
    })
  } catch (error) {
    log.warn({ userId, event, err: error }, 'security notification failed')
  }
}
