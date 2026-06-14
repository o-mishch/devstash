import 'server-only'
import { z } from 'zod'
import { apiRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/infra/rate-limit'
import { triggerPasswordReset } from '@/lib/auth/auth-service'
import { parseOrFail, EmailSchema } from '@/lib/utils/validators'
import type { AuthRedirectData } from '@/types/auth'

const forgotPasswordSchema = z.object({ email: EmailSchema })

export const POST = apiRoute(async (request) => {
  const ip = getRequestIP(request)
  const denied = await rateLimitRoute('forgotPassword', ip)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => null)
  const parsed = parseOrFail(forgotPasswordSchema, body)
  if (!parsed.success) return parsed.response
  const { email } = parsed.data

  await triggerPasswordReset(email)

  return ApiResponse.OK<AuthRedirectData>({
    redirectTo: `/forgot-password?sent=1&email=${encodeURIComponent(email)}`,
  })
})
