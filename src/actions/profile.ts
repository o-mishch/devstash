'use server'

import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { auth, signOut } from '@/auth'
import { prisma } from '@/lib/prisma'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { validatePassword } from '@/lib/utils/validators'
import { updateUserPassword, unlinkUserAccount } from '@/lib/db/profile'


async function withAuth<T>(fn: (userId: string) => Promise<ApiBody<T>>): Promise<ApiBody<T>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.') as ApiBody<T>
  return fn(session.user.id)
}

export async function changePasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const currentPassword = (formData.get('currentPassword') as string) ?? ''
    const newPassword = (formData.get('newPassword') as string) ?? ''
    const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

    if (!currentPassword || !newPassword || !confirmPassword) {
      return ApiResponse.BAD_REQUEST('All fields are required.')
    }
    
    const error = validatePassword(newPassword, confirmPassword)
    if (error) return ApiResponse.BAD_REQUEST(error)

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    })

    if (!user?.password) {
      return ApiResponse.BAD_REQUEST('Your account does not have a password.')
    }

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return ApiResponse.BAD_REQUEST('Current password is incorrect.')
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await updateUserPassword(userId, hashed)

    return ApiResponse.OK()
  })
}

export async function unlinkProviderAction(accountId: string): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        password: true,
        accounts: { select: { id: true } },
      },
    })

    if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')

    const totalAuthMethods = (user.password ? 1 : 0) + user.accounts.length
    if (totalAuthMethods <= 1) {
      return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')
    }

    const account = await prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    })

    if (!account) return ApiResponse.NOT_FOUND('Account not found.')

    await unlinkUserAccount(userId, accountId)

    return ApiResponse.OK()
  })
}

export async function deleteAccountAction(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  await prisma.user.delete({ where: { id: session.user.id } })
  await signOut({ redirect: false })
  redirect('/')
}
