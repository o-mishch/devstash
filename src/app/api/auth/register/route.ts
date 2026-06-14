import 'server-only'
import { z } from 'zod'
import { apiRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/infra/rate-limit'
import { registerUser, type VerificationResult } from '@/lib/auth/auth-service'
import { passwordMatchRefine, parseOrFail, EmailSchema, NameSchema, passwordFieldSchema } from '@/lib/utils/validators'
import type { AuthRedirectData } from '@/types/auth'

const registerSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

export const POST = apiRoute(async (request) => {
  const ip = getRequestIP(request)
  const denied = await rateLimitRoute('register', ip)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => null)
  const parsed = parseOrFail(registerSchema, body)
  if (!parsed.success) return parsed.response
  const { name, email, password } = parsed.data

  const verification: VerificationResult = await registerUser(name, email, password)

  if (verification === 'skipped') {
    return ApiResponse.OK<AuthRedirectData>({ redirectTo: '/sign-in' })
  }

  return ApiResponse.OK<AuthRedirectData>({
    redirectTo: `/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`,
  })
})
