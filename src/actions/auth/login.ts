'use server'

import { signIn, signOut } from '@/auth'
import { AuthError } from 'next-auth'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { rateLimitAction, getActionIP } from '@/lib/rate-limit'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'

interface SignInData {
  email: string
}

export async function signInWithGitHub() {
  await signIn('github', { redirectTo: '/dashboard' })
}

export async function signInWithCredentials(
  _prevState: ApiBody<SignInData | null> | null,
  formData: FormData
): Promise<ApiBody<SignInData | null>> {
  const email = (formData.get('email') as string) ?? ''
  const password = (formData.get('password') as string) ?? ''

  if (!email) return ApiResponse.BAD_REQUEST('Email is required.')

  const ip = await getActionIP()
  const rl = await rateLimitAction('login', `${ip}:${email.toLowerCase().trim()}`)
  if (rl) return rl

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
        case 'CredentialsSignin':
          return ApiResponse.BAD_REQUEST('Invalid email or password.')
        default:
          return ApiResponse.BAD_REQUEST('Something went wrong. Please try again.')
      }
    }
    throw error
  }

  return ApiResponse.OK()
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' })
}
