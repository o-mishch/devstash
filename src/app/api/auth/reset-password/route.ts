import 'server-only'
import { z } from 'zod'
import { apiRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/infra/rate-limit'
import { applyPasswordReset } from '@/lib/auth/auth-service'
import { parseOrFail, passwordFieldSchema, passwordMatchRefine } from '@/lib/utils/validators'

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'This reset link is invalid or has expired.'),
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

export const POST = apiRoute(async (request) => {
  const ip = getRequestIP(request)
  const denied = await rateLimitRoute('resetPassword', ip)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => null)
  const parsed = parseOrFail(resetPasswordSchema, body)
  if (!parsed.success) return parsed.response
  const { token, password } = parsed.data

  const result = await applyPasswordReset(token, password)
  if (result !== 'ok') return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')

  return ApiResponse.OK()
})
