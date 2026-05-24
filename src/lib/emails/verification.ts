import { prisma } from '@/lib/prisma'
import { resend, EMAIL_FROM } from '@/lib/resend'
import { createVerificationToken, TOKEN_TTL_MS } from '@/lib/tokens'
import verificationHtml from './verification.html'

const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
const RATE_LIMIT_MS = 55 * 60 * 1000

export async function sendVerificationEmail(to: string, token: string) {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`
  const html = verificationHtml.replace('{{VERIFY_URL}}', verifyUrl)

  console.log(`[verification] sending email to ${to}`)

  const { data, error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to: [to],
      subject: 'Verify your DevStash email',
      html,
    },
    { idempotencyKey: `verify-email/${token}` }
  )

  if (error) {
    console.error(`[verification] failed to send email to ${to}:`, error.message)
  } else {
    console.log(`[verification] email sent to ${to} (id: ${data?.id})`)
  }
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

  if (existing && existing.expires.getTime() > Date.now() + (TOKEN_TTL_MS - RATE_LIMIT_MS)) return false

  const token = await createVerificationToken(email)
  await sendVerificationEmail(email, token)
  return true
}
