'use server'

import { redirect } from 'next/navigation'
import { signOut } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { withAuth, getCurrentUserId } from '@/lib/session'
import type { ApiBody } from '@/types/api'
import { validatePassword } from '@/lib/utils/validators'
import { rateLimitAction } from '@/lib/rate-limit'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth-service'
import { getUserAuthMethods, getUserAuthInfoByEmail, deleteUserById, checkAccountExists, unlinkUserAccount, removeUserPassword } from '@/lib/db/users'
import { getProfileData, updateUserEmail, updateUserName } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/cache'
import { z } from 'zod'

const NameSchema = z.string().trim().min(1, 'Name is required.').max(64, 'Name is too long.')
const EmailSchema = z.string().trim().toLowerCase().min(1, 'Email is required.').email('Please enter a valid email address.')

export async function updateNameAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const parseResult = NameSchema.safeParse(formData.get('name'))
    if (!parseResult.success) return ApiResponse.BAD_REQUEST(parseResult.error.issues[0].message)
    const name = parseResult.data

    await updateUserName(userId, name)
    invalidateProfileCache(userId)

    return ApiResponse.OK()
  })
}

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

export async function setInitialPasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const rl = await rateLimitAction('changePassword', userId)
    if (rl) return rl

    const parseResult = EmailSchema.safeParse(formData.get('email'))
    if (!parseResult.success) return ApiResponse.BAD_REQUEST(parseResult.error.issues[0].message)
    const selectedEmail = parseResult.data

    const newPassword = (formData.get('newPassword') as string) ?? ''
    const confirmPassword = (formData.get('confirmPassword') as string) ?? ''

    const passwordError = validatePassword(newPassword, confirmPassword)
    if (passwordError) return ApiResponse.BAD_REQUEST(passwordError)

    const user = await getUserAuthMethods(userId)
    if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
    if (user.password) return ApiResponse.CONFLICT('You already have a password. Use Change Password instead.')

    // Check the email isn't already taken by a different account
    const existing = await getUserAuthInfoByEmail(selectedEmail)
    if (existing && existing.id !== userId) {
      return ApiResponse.CONFLICT('That email address is already in use by another account.')
    }

    // Update primary email only if it's not already this user's email
    if (!existing) {
      await updateUserEmail(userId, selectedEmail)
    }

    await changeUserPassword(userId, newPassword)

    return ApiResponse.OK()
  })
}

export async function changeCredentialEmailAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const rl = await rateLimitAction('changePassword', userId)
    if (rl) return rl

    const parseResult = EmailSchema.safeParse(formData.get('email'))
    if (!parseResult.success) return ApiResponse.BAD_REQUEST(parseResult.error.issues[0].message)
    const newEmail = parseResult.data

    const password = (formData.get('password') as string) ?? ''
    if (!password) return ApiResponse.BAD_REQUEST('Password is required.')

    const user = await getUserAuthMethods(userId)
    if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
    if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')

    const valid = await verifyUserPasswordById(userId, password)
    if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')

    const existing = await getUserAuthInfoByEmail(newEmail)
    if (existing && existing.id !== userId) return ApiResponse.CONFLICT('That email is already in use.')

    await updateUserEmail(userId, newEmail)
    invalidateProfileCache(userId)

    return ApiResponse.OK()
  })
}

export async function removeCredentialsAction(): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const user = await getUserAuthMethods(userId)
    if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
    if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')
    if (user.accounts.length === 0) return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')

    await removeUserPassword(userId)
    invalidateProfileCache(userId)

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

// Allows switching the primary email to any email owned via a linked OAuth account.
export async function updateMainEmailAction(newEmailRaw: string): Promise<ApiBody<null>> {
  return withAuth(async (userId) => {
    const parseResult = EmailSchema.safeParse(newEmailRaw)
    if (!parseResult.success) return ApiResponse.BAD_REQUEST('Invalid email.')
    const newEmail = parseResult.data

    const data = await getProfileData(userId)
    if (!data) return ApiResponse.UNAUTHORIZED('Not authenticated.')

    // Build the set of emails this user legitimately owns
    const ownedEmails = new Set<string>([data.user.email])
    for (const account of data.user.accounts) {
      if (account.email) ownedEmails.add(account.email)
    }

    if (!ownedEmails.has(newEmail)) {
      return ApiResponse.FORBIDDEN('You can only set an email from one of your linked accounts.')
    }

    if (newEmail === data.user.email) return ApiResponse.OK()

    await updateUserEmail(userId, newEmail)
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
