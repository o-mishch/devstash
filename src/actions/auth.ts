'use server'

import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/auth'
import { AuthError } from 'next-auth'
import bcrypt from 'bcryptjs'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { rateLimitAction, getActionIP } from '@/lib/rate-limit'
import {
  registerUser,
  triggerPasswordReset,
  applyPasswordReset,
  type VerificationResult,
} from '@/lib/auth-service'
import { emailVerificationEnabled } from '@/lib/emails/verification'
import { prisma } from '@/lib/prisma'
import { getPendingLink, deletePendingLink } from '@/lib/pending-link'

const MAX_PASSWORD_LENGTH = 128

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
    const user = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } })
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

/**
 * Bound Server Action for resetting a password from the web form.
 * `token` is encrypted and bound server-side via `.bind(null, token)` —
 * it is never exposed as a visible form field.
 */
export async function resetPasswordAction(
  token: string,
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const rl = await rateLimitAction('resetPassword', await getActionIP())
  if (rl) return rl

  const password = (formData.get('password') as string) ?? ''
  const confirm = (formData.get('confirmPassword') as string) ?? ''

  if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  if (password.length > MAX_PASSWORD_LENGTH) return ApiResponse.BAD_REQUEST('Password is too long.')
  if (password !== confirm) return ApiResponse.BAD_REQUEST('Passwords do not match.')

  const result = await applyPasswordReset(token, password)

  if (result !== 'ok') return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')

  return ApiResponse.OK()
}

export async function forgotPasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const email = (formData.get('email') as string) ?? ''

  if (!email) return ApiResponse.BAD_REQUEST('Email is required.')

  const rl = await rateLimitAction('forgotPassword', await getActionIP())
  if (rl) return rl

  await triggerPasswordReset(email)

  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`)
}

export async function registerAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const name = (formData.get('name') as string) ?? ''
  const email = (formData.get('email') as string) ?? ''
  const password = (formData.get('password') as string) ?? ''
  const confirm = (formData.get('confirmPassword') as string) ?? ''

  const rl = await rateLimitAction('register', await getActionIP())
  if (rl) return rl

  if (!name || !email || !password) return ApiResponse.BAD_REQUEST('All fields are required.')
  if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  if (password.length > MAX_PASSWORD_LENGTH) return ApiResponse.BAD_REQUEST('Password is too long.')
  if (password !== confirm) return ApiResponse.BAD_REQUEST('Passwords do not match.')

  const verification: VerificationResult = await registerUser(name, email, password)

  if (verification === 'skipped') redirect('/sign-in')

  redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`)
}

/**
 * Verifies the user's existing password, creates the OAuth Account record,
 * then signs them in with credentials — all in one step.
 * `token` is the Redis pending-link key, bound server-side via `.bind(null, token)`.
 */
export async function linkAccountAction(
  token: string,
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const rl = await rateLimitAction('linkAccount', await getActionIP())
  if (rl) return rl

  const password = (formData.get('password') as string) ?? ''

  if (!password) return ApiResponse.BAD_REQUEST('Password is required.')
  if (password.length > MAX_PASSWORD_LENGTH) return ApiResponse.BAD_REQUEST('Password is too long.')

  const pending = await getPendingLink(token)
  if (!pending) {
    return ApiResponse.BAD_REQUEST('This link has expired. Please try signing in with GitHub again.')
  }

  const user = await prisma.user.findUnique({
    where: { email: pending.email },
    select: { id: true, password: true },
  })

  if (!user?.password) {
    return ApiResponse.BAD_REQUEST('Account not found or does not have a password set.')
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')

  // Idempotent: skip if already linked (e.g. double-submit)
  const alreadyLinked = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: pending.provider,
        providerAccountId: pending.providerAccountId,
      },
    },
    select: { id: true },
  })

  if (!alreadyLinked) {
    await prisma.account.create({
      data: {
        userId: user.id,
        type: pending.type,
        provider: pending.provider,
        providerAccountId: pending.providerAccountId,
        access_token: pending.access_token,
        refresh_token: pending.refresh_token,
        expires_at: pending.expires_at,
        token_type: pending.token_type,
        scope: pending.scope,
        id_token: pending.id_token,
        session_state: pending.session_state,
      },
    })
  }

  await deletePendingLink(token)

  // In NextAuth v5 beta, signIn() inside a Server Action always throws NEXT_REDIRECT
  // regardless of `redirect: false`. We lean into that behaviour by passing redirectTo
  // explicitly so the browser lands on /dashboard instead of bouncing back to
  // /link-account?token=... (where the now-deleted token would trigger "Link expired").
  await signIn('credentials', { email: pending.email, password, redirectTo: '/dashboard' })

  // signIn with redirectTo always throws NEXT_REDIRECT above; this line is unreachable
  // but satisfies the return-type for the compiler.
  return ApiResponse.OK()
}
