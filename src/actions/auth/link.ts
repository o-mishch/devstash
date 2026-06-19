'use server'

import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { signIn, auth, LINK_INTENT_COOKIE } from '@/auth'
import type { ActionState } from '@/types/actions'
import { withRateLimit, rateLimitAction, getActionIP } from '@/lib/infra/rate-limit'
import { getPendingLink, consumePendingLink } from '@/lib/auth/pending-link'
import { validateUserPassword, linkPendingAccount } from '@/lib/auth/auth-service'
import { loginPasswordSchema, parseOrFail } from '@/lib/utils/validators'

export async function linkAccountAction(
  token: string,
  _prevState: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  return withRateLimit('linkAccount', async () => {
    const result = parseOrFail(loginPasswordSchema, formData.get('password') || '')
    if (!result.success) return result.response
    const password = result.data

    const pending = await getPendingLink(token)
    if (!pending) {
      return { success: false, message: 'This link has expired. Please try signing in again.' }
    }

    const user = await validateUserPassword(pending.email, password)
    if (!user) {
      return { success: false, message: 'Incorrect password or account not found.' }
    }

    await linkPendingAccount(user.id, pending)

    // Consume after link succeeds — wrong-password and link failures keep the token for retry.
    // A null consume after link means a concurrent request won the race; linking is idempotent, so sign in.
    await consumePendingLink(token)

    try {
      // NextAuth 5 does not log credential values passed to signIn — password is safe here.
      await signIn('credentials', { email: pending.email, password, redirectTo: '/dashboard' })
    } catch (error) {
      if (error instanceof AuthError) {
        return { success: false, message: 'Account linked. Please sign in with your password.' }
      }
      throw error
    }
    return { success: true }
  })
}

// Used when the user is already signed in and clicked "Add account" from the profile page.
// The link-intent flow stores the pending link keyed by the user's primary email; we verify
// the active session matches that email before creating the Account row.
export async function autoLinkAccountAction(token: string): Promise<void> {
  const denied = await rateLimitAction('linkAccount', await getActionIP())
  if (denied) redirect('/profile?toast=rate_limited')

  const session = await auth()
  if (!session?.user?.id || !session?.user?.email) redirect('/sign-in')

  const pending = await getPendingLink(token)
  if (!pending) {
    redirect('/profile?toast=expired')
  }

  // Security: the pending link must be for the signed-in user's account
  if (pending.email !== session.user.email) {
    await consumePendingLink(token)
    redirect('/profile?toast=mismatch')
  }

  await linkPendingAccount(session.user.id, pending)
  await consumePendingLink(token)
  ;(await cookies()).delete(LINK_INTENT_COOKIE)
  redirect('/profile?toast=linked')
}
