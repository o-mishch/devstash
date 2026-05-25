'use server'

import { signIn, signOut } from '@/auth'
import { AuthError } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resendVerification, emailVerificationEnabled } from '@/lib/emails/verification'

export async function resendVerificationEmail(email: string): Promise<boolean> {
  return resendVerification(email)
}

export async function signInWithGitHub() {
  await signIn('github', { redirectTo: '/dashboard' })
}

export type SignInState = {
  status: 'idle' | 'success' | 'unverified' | 'error'
  message?: string
  email?: string
}

export async function signInWithCredentials(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = (formData.get('email') as string) ?? ''
  const password = (formData.get('password') as string) ?? ''

  if (emailVerificationEnabled()) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true },
    })
    if (user && !user.emailVerified) {
      return { status: 'unverified', email }
    }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return { status: 'error', message: 'Invalid email or password.' }
        default:
          return { status: 'error', message: 'Something went wrong. Please try again.' }
      }
    }
    throw error
  }
  return { status: 'success' }
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' })
}
