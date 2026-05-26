'use server'

import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/auth'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { AuthError } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'
import { consumePasswordResetToken } from '@/lib/tokens'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

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

  if (emailVerificationEnabled()) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true },
    })
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
  const password = (formData.get('password') as string) ?? ''
  const confirm = (formData.get('confirmPassword') as string) ?? ''

  if (password.length < 8) {
    return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  }
  if (password !== confirm) {
    return ApiResponse.BAD_REQUEST('Passwords do not match.')
  }

  const result = await consumePasswordResetToken(token)

  if (!result) {
    return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')
  }

  const user = await prisma.user.findUnique({
    where: { email: result.email },
    select: { id: true, password: true },
  })

  if (!user?.password) {
    return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  })

  return ApiResponse.OK()
}

export async function forgotPasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const email = (formData.get('email') as string) ?? ''

  if (!email) return ApiResponse.BAD_REQUEST('Email is required.')

  const user = await prisma.user.findUnique({
    where: { email },
    select: { password: true },
  })

  if (user?.password) {
    await sendPasswordResetRequest(email)
  }

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

  if (!name || !email || !password) return ApiResponse.BAD_REQUEST('All fields are required.')
  if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  if (password !== confirm) return ApiResponse.BAD_REQUEST('Passwords do not match.')

  const verificationEnabled = emailVerificationEnabled()
  const existing = await prisma.user.findUnique({ where: { email } })

  let verification: VerificationResult = verificationEnabled ? 'sent' : 'skipped'

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        emailVerified: verificationEnabled ? undefined : new Date(),
      },
    })

    if (verificationEnabled) {
      verification = await sendRegistrationVerification(email)
    }
  }

  if (verification === 'skipped') {
    redirect('/sign-in')
  }

  redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`)
}
