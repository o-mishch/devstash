'use server'

import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { auth, signOut } from '@/auth'
import { prisma } from '@/lib/prisma'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'

export async function changePasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const currentPassword = (formData.get('currentPassword') as string) ?? ''
  const newPassword = (formData.get('newPassword') as string) ?? ''
  const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

  if (!currentPassword || !newPassword || !confirmPassword) {
    return ApiResponse.BAD_REQUEST('All fields are required.')
  }
  if (newPassword.length < 8) {
    return ApiResponse.BAD_REQUEST('New password must be at least 8 characters.')
  }
  if (newPassword !== confirmPassword) {
    return ApiResponse.BAD_REQUEST('Passwords do not match.')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  })

  return ApiResponse.OK()
}

export async function unlinkProviderAction(accountId: string): Promise<ApiBody<null>> {
  const session = await auth()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED('Not authenticated.')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
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
    where: { id: accountId, userId: session.user.id },
    select: { id: true },
  })

  if (!account) return ApiResponse.NOT_FOUND('Account not found.')

  await prisma.account.delete({ where: { id: accountId } })

  return ApiResponse.OK()
}

export async function deleteAccountAction(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  await prisma.user.delete({ where: { id: session.user.id } })
  await signOut({ redirect: false })
  redirect('/')
}
