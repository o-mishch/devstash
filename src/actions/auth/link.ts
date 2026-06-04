'use server'

import { redirect } from 'next/navigation'
import { signIn, auth } from '@/auth'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { withRateLimit } from '@/lib/rate-limit'
import { getPendingLink, deletePendingLink } from '@/lib/pending-link'
import { validateUserPassword, linkPendingAccount } from '@/lib/auth-service'
import { MAX_PASSWORD_LENGTH, parseOrFail } from '@/lib/utils/validators'
import { z } from 'zod'

const LinkPasswordSchema = z.string().min(1, 'Password is required.').max(MAX_PASSWORD_LENGTH, 'Password is too long.')

export async function linkAccountAction(
  token: string,
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withRateLimit('linkAccount', async () => {
    const result = parseOrFail(LinkPasswordSchema, formData.get('password') || '')
    if (!result.success) return result.response
    const password = result.data

    const pending = await getPendingLink(token)
    if (!pending) {
      return ApiResponse.BAD_REQUEST('This link has expired. Please try signing in again.')
    }

    const user = await validateUserPassword(pending.email, password)
    if (!user) {
      return ApiResponse.BAD_REQUEST('Incorrect password or account not found.')
    }

    await linkPendingAccount(user.id, pending)

    await deletePendingLink(token)

    await signIn('credentials', { email: pending.email, password, redirectTo: '/dashboard' })

    return ApiResponse.OK()
  })
}

// Used when the user is already signed in and clicked "Add account" from the profile page.
// The link-intent flow stores the pending link keyed by the user's primary email; we verify
// the active session matches that email before creating the Account row.
export async function autoLinkAccountAction(token: string): Promise<void> {
  const session = await auth()
  if (!session?.user?.id || !session?.user?.email) redirect('/sign-in')

  const pending = await getPendingLink(token)
  if (!pending) {
    redirect('/profile?toast=expired')
  }

  // Security: the pending link must be for the signed-in user's account
  if (pending.email !== session.user.email) {
    redirect('/profile?toast=mismatch')
  }

  await linkPendingAccount(session.user.id, pending)

  await deletePendingLink(token)
  redirect('/profile?toast=linked')
}
