'use server'

import { redirect } from 'next/navigation'
import { resendVerification } from '@/lib/emails/verification'
import { rateLimitAction, getActionIP } from '@/lib/rate-limit'

export async function resendVerificationAction(email: string) {
  const ip = await getActionIP()

  const ipRl = await rateLimitAction('resendVerificationIP', ip)
  if (ipRl) return

  const emailRl = await rateLimitAction('resendVerification', `${ip}:${email}`)
  if (emailRl) return

  await resendVerification(email)
  redirect('/sign-in?resent=1')
}
