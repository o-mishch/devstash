import { sendEmail } from '@/lib/infra/resend'
import { getUserById } from '@/lib/db/users'
import { getBaseUrl } from '@/lib/utils/url'
import { logger } from '@/lib/infra/pino'
import { buildEmailTemplate } from './template-builder'
import securityHtml from './security-notification.html'

const log = logger.child({ tag: 'security-notification' })

// Security-relevant account changes that warrant notifying the owner (OWASP best practice). Always
// sent to the account's primary `User.email`, never a secondary — so it leaks nothing new. (Case 7)
export type SecurityEventType =
  | 'password-set'
  | 'password-changed'
  | 'password-reset'
  | 'password-removed'
  | 'method-linked'
  | 'method-unlinked'

interface SecurityEventCopy {
  subject: string
  heading: string
  message: string
}

const EVENT_COPY: Record<SecurityEventType, SecurityEventCopy> = {
  'password-set': {
    subject: 'A password was added to your DevStash account',
    heading: 'Password added',
    message: 'A password was just set on your DevStash account. You can now sign in with your email and password in addition to any linked sign-in methods.',
  },
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
}

/**
 * Fire-and-forget notification to the account owner. Never throws and never blocks the operation —
 * a send failure is logged, consistent with the rest of our email handling. Resolves the primary
 * email itself so callers only need the userId.
 */
export async function sendSecurityNotification(userId: string, event: SecurityEventType): Promise<void> {
  try {
    const user = await getUserById(userId)
    if (!user?.email) return

    const { subject, heading, message } = EVENT_COPY[event]
    const bodyHtml = securityHtml
      .replace('{{HEADING}}', heading)
      .replace('{{MESSAGE}}', message)
      .replace('{{SETTINGS_URL}}', `${getBaseUrl()}/profile`)
    const html = buildEmailTemplate(subject, bodyHtml)

    await sendEmail({
      to: user.email,
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
