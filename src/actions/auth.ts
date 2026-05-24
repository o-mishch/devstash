'use server'

import { signIn, signOut } from '@/auth'
import { AuthError } from 'next-auth'

export async function signInWithGitHub() {
  await signIn('github', { redirectTo: '/dashboard' })
}

type SignInState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'error'; message: string }

export async function signInWithCredentials(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirect: false,
    })
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
