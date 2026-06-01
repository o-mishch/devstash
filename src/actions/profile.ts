'use server'

import { redirect } from 'next/navigation'
import { signOut } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { withAuth, getCurrentUserId } from '@/lib/session'
import type { ApiBody } from '@/types/api'
import { validatePassword } from '@/lib/utils/validators'
import { rateLimitAction } from '@/lib/rate-limit'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth-service'
import { getUserAuthMethods, deleteUserById, checkAccountExists, unlinkUserAccount } from '@/lib/db/users'
import { invalidateProfileCache } from '@/lib/cache'

export async function changePasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const rl = await rateLimitAction('changePassword', userId)
    if (rl) return rl

    const currentPassword = (formData.get('currentPassword') as string) ?? ''
    const newPassword = (formData.get('newPassword') as string) ?? ''
    const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

    if (!currentPassword || !newPassword || !confirmPassword) {
      return ApiResponse.BAD_REQUEST('All fields are required.')
    }

    const error = validatePassword(newPassword, confirmPassword)
    if (error) return ApiResponse.BAD_REQUEST(error)

    const valid = await verifyUserPasswordById(userId, currentPassword)
    if (!valid) {
      return ApiResponse.BAD_REQUEST('Current password is incorrect or not set.')
    }

    await changeUserPassword(userId, newPassword)

    return ApiResponse.OK()
  })
}

export async function unlinkProviderAction(accountId: string): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const user = await getUserAuthMethods(userId)

    if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')

    const totalAuthMethods = (user.password ? 1 : 0) + user.accounts.length
    if (totalAuthMethods <= 1) {
      return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')
    }

    const account = await checkAccountExists(accountId, userId)

    if (!account) return ApiResponse.NOT_FOUND('Account not found.')

    await unlinkUserAccount(userId, accountId)
    invalidateProfileCache(userId)

    return ApiResponse.OK()
  })
}

export async function deleteAccountAction(): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

  await deleteUserById(userId)
  await signOut({ redirect: false })
  redirect('/')
}
