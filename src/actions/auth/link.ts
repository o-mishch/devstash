'use server'

import { signIn } from '@/auth'
import bcrypt from 'bcryptjs'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { withRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { getPendingLink, deletePendingLink } from '@/lib/pending-link'
import { MAX_PASSWORD_LENGTH } from '@/lib/utils/validators'

export async function linkAccountAction(
  token: string,
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withRateLimit('linkAccount', async () => {
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

    await signIn('credentials', { email: pending.email, password, redirectTo: '/dashboard' })

    return ApiResponse.OK()
  })
}
