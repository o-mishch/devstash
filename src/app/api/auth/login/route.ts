import 'server-only'
import { z } from 'zod'
import { signIn } from '@/auth'
import { AuthError } from 'next-auth'
import { apiRoute, ApiResponse } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { parseOrFail, EmailSchema } from '@/lib/utils/validators'
import type { SignInData } from '@/types/auth'

const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required.'),
})

export const POST = apiRoute(async (request) => {
  const body: unknown = await request.json().catch(() => null)
  const result = parseOrFail(SignInSchema, body)
  if (!result.success) return result.response

  const { email, password } = result.data

  if (emailVerificationEnabled()) {
    const user = await getUserEmailVerified(email)
    if (user && !user.emailVerified) {
      return ApiResponse.FORBIDDEN<SignInData>({ email }, 'Please verify your email before signing in.')
    }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === 'CredentialsSignin') {
        // Only count failed attempts — successful logins must not consume the budget
        const ip = getRequestIP(request)
        const rl = await rateLimitRoute('login', `${ip}:${email}`)
        if (rl) return rl
        return ApiResponse.BAD_REQUEST('Invalid email or password.')
      }
      return ApiResponse.BAD_REQUEST('Something went wrong. Please try again.')
    }
    throw error
  }

  return ApiResponse.OK()
})
