import { prisma } from '@/lib/prisma'
import { resend, EMAIL_FROM, BASE_URL } from '@/lib/resend'
import { createVerificationToken, TOKEN_TTL_MS } from '@/lib/tokens'
import verificationHtml from './verification.html'

const RATE_LIMIT_MS = 55 * 60 * 1000

export const emailVerificationEnabled = () =>
  process.env.DISABLE_EMAIL_VERIFICATION !== 'true'

export type VerificationResult = 'sent' | 'failed' | 'skipped'

export async function sendVerificationEmail(to: string, token: string): Promise<boolean> {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`
  const html = verificationHtml.replace('{{VERIFY_URL}}', verifyUrl)

  const { error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to: [to],
      subject: 'Verify your DevStash email',
      html,
    },
    { idempotencyKey: `verify-email/${token}` }
  )

  if (error) {
    console.error('[verification] failed to send email:', error.message)
    return false
  }

  return true
}

export async function resendVerification(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true },
  })

  if (!user || user.emailVerified) return false

  const existing = await prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  })

  const tokenCreatedAt = existing ? existing.expires.getTime() - TOKEN_TTL_MS : 0
  const isTokenFresh = !!existing && Date.now() - tokenCreatedAt < RATE_LIMIT_MS

  if (isTokenFresh) {
    return sendVerificationEmail(email, existing.token)
  }

  const token = await createVerificationToken(email)
  return sendVerificationEmail(email, token)
}

export async function sendRegistrationVerification(email: string): Promise<VerificationResult> {
  const token = await createVerificationToken(email)
  const sent = await sendVerificationEmail(email, token)
  return sent ? 'sent' : 'failed'
}
