'use server'

import { cookies } from 'next/headers'
import { signIn, auth, LINK_INTENT_COOKIE } from '@/auth'
import { AuthError } from 'next-auth'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { rateLimitAction, getActionIP } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { createLinkIntent } from '@/lib/auth/pending-link'
import type { OAuthProvider } from '@/lib/utils/constants'
import { z } from 'zod'
import { parseOrFail, EmailSchema } from '@/lib/utils/validators'

const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required.'),
})

interface SignInData {
  email: string
}

export async function signInWithGitHub() {
  await signIn('github', { redirectTo: '/dashboard' })
}

export async function signInWithGoogle() {
  await signIn('google', { redirectTo: '/dashboard' })
}

// Used from the profile page to link an additional OAuth provider.
// Stores the current user's ID in Redis, sets a short-lived httpOnly cookie so the
// signIn callback in auth.ts can identify this as a link-intent flow (not a sign-in).
export async function linkWithProviderAction(provider: OAuthProvider): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  const intentToken = await createLinkIntent(session.user.id)
  if (intentToken) {
    const cookieStore = await cookies()
    cookieStore.set(LINK_INTENT_COOKIE, intentToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300, // 5 minutes — matches Redis TTL
      path: '/',
    })
  }

  await signIn(provider, { redirectTo: '/profile' })
}

export async function signInWithCredentials(
  _prevState: ApiBody<SignInData | null> | null,
  formData: FormData
): Promise<ApiBody<SignInData | null>> {
  const result = parseOrFail(SignInSchema, {
    email: formData.get('email') || '',
    password: formData.get('password') || '',
  })

  if (!result.success) return result.response

  const { email, password } = result.data

  if (emailVerificationEnabled()) {
    const user = await getUserEmailVerified(email)
    if (user && !user.emailVerified) {
      return ApiResponse.FORBIDDEN({ email }, 'Please verify your email before signing in.')
    }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin': {
          // Only count failed attempts — successful logins must not consume the budget
          const ip = await getActionIP()
          const rl = await rateLimitAction('login', `${ip}:${email}`)
          if (rl) return rl
          return ApiResponse.BAD_REQUEST('Invalid email or password.')
        }
        default:
          return ApiResponse.BAD_REQUEST('Something went wrong. Please try again.')
      }
    }
    throw error
  }

  return ApiResponse.OK()
}

