'use server'

import { cookies } from 'next/headers'
import { signIn, auth, LINK_INTENT_COOKIE } from '@/auth'
import { createLinkIntent } from '@/lib/auth/pending-link'
import type { OAuthProvider } from '@/lib/utils/constants'

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
