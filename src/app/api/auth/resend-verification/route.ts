import { NextRequest } from 'next/server'
import { resendVerification } from '@/lib/emails/verification'
import { ApiResponse, apiRoute } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/rate-limit'

export const POST = apiRoute(async (request: NextRequest) => {
  const ip = getRequestIP(request)

  // Broad IP-only guard — separate bucket, does not consume per-email quota
  const ipRl = await rateLimitRoute('resendVerificationIP', ip)
  if (ipRl) return ipRl

  const { email } = await request.json()

  if (!email || typeof email !== 'string') return ApiResponse.BAD_REQUEST('Email is required.')

  // Tighter per-IP+email guard for the actual send
  const emailRl = await rateLimitRoute('resendVerification', `${ip}:${email}`)
  if (emailRl) return emailRl

  await resendVerification(email)

  return ApiResponse.OK()
})
