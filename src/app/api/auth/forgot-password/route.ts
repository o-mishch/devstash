import { ApiResponse, apiRoute } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/rate-limit'
import { triggerPasswordReset } from '@/lib/auth-service'

const RESET_SENT_MSG = 'If that email exists, we sent a reset link.'

export const POST = apiRoute(async (request) => {
  const rl = await rateLimitRoute('forgotPassword', getRequestIP(request))
  if (rl) return rl

  const { email } = await request.json()

  if (!email || typeof email !== 'string') return ApiResponse.BAD_REQUEST('Email is required.')

  await triggerPasswordReset(email)

  return ApiResponse.OK(RESET_SENT_MSG)
})
