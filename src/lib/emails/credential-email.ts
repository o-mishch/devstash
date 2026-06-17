import 'server-only'

import type { CredentialEmailMode } from '@/lib/auth/tokens'
import { sendTokenLinkEmail } from './link-email'

interface CredentialEmailCopy {
  subject: string
  heading: string
  intro: string
  cta: string
}

// 'add' confirms a brand-new credential login (the password is chosen on the confirm page); 'change'
// re-points an existing login to this address (no password — the confirm page only re-verifies it).
const COPY: Record<CredentialEmailMode, CredentialEmailCopy> = {
  add: {
    subject: 'Confirm your DevStash sign-in email',
    heading: 'Confirm your sign-in email',
    intro:
      'Click the button below to confirm this email for password sign-in on your DevStash account ' +
      'and set your password. This link expires in <strong>1 hour</strong>.',
    cta: 'Confirm &amp; set password',
  },
  change: {
    subject: 'Confirm your new DevStash sign-in email',
    heading: 'Confirm your new sign-in email',
    intro:
      'Click the button below to switch your email &amp; password sign-in to this address. Your ' +
      'password and your other sign-in methods stay the same. This link expires in <strong>1 hour</strong>.',
    cta: 'Confirm new sign-in email',
  },
}

/** Sends the credential-login-email confirmation link for a token already stored in Redis. */
export async function sendCredentialEmailLink(
  email: string,
  token: string,
  mode: CredentialEmailMode,
): Promise<boolean> {
  const copy = COPY[mode]
  return sendTokenLinkEmail({
    to: email,
    token,
    path: 'confirm-login-email',
    subject: copy.subject,
    heading: copy.heading,
    intro: copy.intro,
    cta: copy.cta,
    disclaimer:
      "If you didn't request this, you can safely ignore this email — nothing changes until the link is used.",
    keyPrefix: 'credential-email',
    operation: 'credential-email',
  })
}
