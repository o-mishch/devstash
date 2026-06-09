'use server'

import { signOut } from '@/auth'
import { ApiResponse } from '@/lib/api'
import { withAuthAndRateLimit } from '@/lib/session'
import type { ApiBody } from '@/types/api'
import { validatePassword, parseOrFail, EmailSchema, MAX_PASSWORD_LENGTH } from '@/lib/utils/validators'
import { verifyUserPasswordById, changeUserPassword } from '@/lib/auth/auth-service'
import { getUserAuthMethods, getUserAuthInfoByEmail, deleteUserById, checkAccountExists, unlinkUserAccount, removeUserPassword } from '@/lib/db/users'
import { getProfileData, updateUserEmail, updateUserName } from '@/lib/db/profile'
import {
  syncStripeCustomerEmailForUser,
  teardownStripeBillingForUser,
} from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { createLogger } from '@/lib/infra/logger'
import { z } from 'zod'

const log = createLogger('profile-actions')

const NameSchema = z.string().trim().min(1, 'Name is required.').max(64, 'Name is too long.')

const passwordFieldSchema = z.string().trim().min(1, 'All fields are required.').max(MAX_PASSWORD_LENGTH, 'Password is too long.')

const changePasswordSchema = z.object({
  currentPassword: passwordFieldSchema,
  newPassword: passwordFieldSchema,
  confirmPassword: passwordFieldSchema,
}).superRefine((data, ctx) => {
  const error = validatePassword(data.newPassword, data.confirmPassword)
  if (error) {
    ctx.addIssue({ code: 'custom', message: error, path: ['newPassword'] })
  }
})

const setInitialPasswordSchema = z.object({
  email: EmailSchema,
  newPassword: passwordFieldSchema,
  confirmPassword: passwordFieldSchema,
}).superRefine((data, ctx) => {
  const error = validatePassword(data.newPassword, data.confirmPassword)
  if (error) {
    ctx.addIssue({ code: 'custom', message: error, path: ['newPassword'] })
  }
})

const changeCredentialEmailSchema = z.object({
  email: EmailSchema,
  password: passwordFieldSchema,
})

const accountIdSchema = z.string().trim().min(1, 'Account is required.')

async function getOwnedEmailsForUser(userId: string): Promise<Set<string> | null> {
  const data = await getProfileData(userId)
  if (!data) return null

  const ownedEmails = new Set<string>([data.user.email])
  for (const account of data.user.accounts) {
    if (account.email) ownedEmails.add(account.email)
  }
  return ownedEmails
}

export async function updateNameAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('updateSettings', async ({ userId }) => {
    const result = parseOrFail(NameSchema, formData.get('name'))
    if (!result.success) return result.response
    const name = result.data

    await updateUserName(userId, name)
    invalidateProfileCache(userId)

    return ApiResponse.OK()
  })
}

export async function changePasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changePassword', async ({ userId }) => {
    const result = parseOrFail(changePasswordSchema, {
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword'),
    })
    if (!result.success) return result.response

    try {
      const valid = await verifyUserPasswordById(userId, result.data.currentPassword)
      if (!valid) {
        return ApiResponse.BAD_REQUEST('Current password is incorrect or not set.')
      }

      await changeUserPassword(userId, result.data.newPassword)
      return ApiResponse.OK()
    } catch (error) {
      log.error('Password change failed', { userId, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function setInitialPasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changePassword', async ({ userId }) => {
    const result = parseOrFail(setInitialPasswordSchema, {
      email: formData.get('email'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword'),
    })
    if (!result.success) return result.response
    const { email: selectedEmail, newPassword } = result.data

    try {
      const user = await getUserAuthMethods(userId)
      if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (user.password) return ApiResponse.CONFLICT('You already have a password. Use Change Password instead.')

      const ownedEmails = await getOwnedEmailsForUser(userId)
      if (!ownedEmails) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (!ownedEmails.has(selectedEmail)) {
        return ApiResponse.FORBIDDEN('You can only use an email from one of your linked accounts.')
      }

      const existing = await getUserAuthInfoByEmail(selectedEmail)
      if (existing && existing.id !== userId) {
        return ApiResponse.CONFLICT('That email address is already in use by another account.')
      }

      const profile = await getProfileData(userId)
      if (profile && selectedEmail !== profile.user.email) {
        await updateUserEmail(userId, selectedEmail)
        await syncStripeCustomerEmailForUser(userId, selectedEmail)
      }

      await changeUserPassword(userId, newPassword)
      invalidateProfileCache(userId)

      return ApiResponse.OK()
    } catch (error) {
      log.error('Initial password setup failed', { userId, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function changeCredentialEmailAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changeCredentials', async ({ userId }) => {
    const result = parseOrFail(changeCredentialEmailSchema, {
      email: formData.get('email'),
      password: formData.get('password'),
    })
    if (!result.success) return result.response
    const { email: newEmail, password } = result.data

    try {
      const user = await getUserAuthMethods(userId)
      if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')

      const valid = await verifyUserPasswordById(userId, password)
      if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')

      const ownedEmails = await getOwnedEmailsForUser(userId)
      if (!ownedEmails) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (!ownedEmails.has(newEmail)) {
        return ApiResponse.FORBIDDEN('You can only use an email from one of your linked accounts.')
      }

      const existing = await getUserAuthInfoByEmail(newEmail)
      if (existing && existing.id !== userId) return ApiResponse.CONFLICT('That email is already in use.')

      const profile = await getProfileData(userId)
      if (profile && newEmail === profile.user.email) return ApiResponse.OK()

      await updateUserEmail(userId, newEmail)
      await syncStripeCustomerEmailForUser(userId, newEmail)
      invalidateProfileCache(userId)

      return ApiResponse.OK()
    } catch (error) {
      log.error('Credential email change failed', { userId, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function removeCredentialsAction(passwordRaw?: string): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changeCredentials', async ({ userId }) => {
    try {
      const user = await getUserAuthMethods(userId)
      if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (!user.password) return ApiResponse.BAD_REQUEST('No password set.')
      if (user.accounts.length === 0) return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')

      const passwordResult = parseOrFail(passwordFieldSchema, passwordRaw)
      if (!passwordResult.success) {
        return ApiResponse.BAD_REQUEST('Password is required to remove your password.')
      }
      const valid = await verifyUserPasswordById(userId, passwordResult.data)
      if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')

      await removeUserPassword(userId)
      invalidateProfileCache(userId)

      return ApiResponse.OK()
    } catch (error) {
      log.error('Remove credentials failed', { userId, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function unlinkProviderAction(accountId: string): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changeCredentials', async ({ userId }) => {
    const parsed = parseOrFail(accountIdSchema, accountId)
    if (!parsed.success) return parsed.response

    try {
      const user = await getUserAuthMethods(userId)

      if (!user) return ApiResponse.UNAUTHORIZED('Not authenticated.')

      const totalAuthMethods = (user.password ? 1 : 0) + user.accounts.length
      if (totalAuthMethods <= 1) {
        return ApiResponse.BAD_REQUEST('Cannot remove your only sign-in method.')
      }

      const account = await checkAccountExists(parsed.data, userId)

      if (!account) return ApiResponse.NOT_FOUND('Account not found.')

      await unlinkUserAccount(userId, parsed.data)
      invalidateProfileCache(userId)

      return ApiResponse.OK()
    } catch (error) {
      log.error('Unlink provider failed', { userId, accountId: parsed.data, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function updateMainEmailAction(
  newEmailRaw: string,
  passwordRaw?: string,
): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('changeCredentials', async ({ userId }) => {
    const result = parseOrFail(EmailSchema, newEmailRaw)
    if (!result.success) return result.response
    const newEmail = result.data

    try {
      const data = await getProfileData(userId)
      if (!data) return ApiResponse.UNAUTHORIZED('Not authenticated.')

      if (data.user.hasPassword) {
        const passwordResult = parseOrFail(passwordFieldSchema, passwordRaw)
        if (!passwordResult.success) {
          return ApiResponse.BAD_REQUEST('Password is required to change your sign-in email.')
        }
        const valid = await verifyUserPasswordById(userId, passwordResult.data)
        if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')
      }

      const ownedEmails = await getOwnedEmailsForUser(userId)
      if (!ownedEmails) return ApiResponse.UNAUTHORIZED('Not authenticated.')
      if (!ownedEmails.has(newEmail)) {
        return ApiResponse.FORBIDDEN('You can only set an email from one of your linked accounts.')
      }

      if (newEmail === data.user.email) return ApiResponse.OK()

      await updateUserEmail(userId, newEmail)
      await syncStripeCustomerEmailForUser(userId, newEmail)
      invalidateProfileCache(userId)

      return ApiResponse.OK()
    } catch (error) {
      log.error('Update main email failed', { userId, error })
      return ApiResponse.INTERNAL_ERROR()
    }
  })
}

export async function deleteAccountAction(passwordRaw?: string): Promise<ApiBody<null>> {
  return withAuthAndRateLimit('deleteAccount', async ({ userId }) => {
    const authMethods = await getUserAuthMethods(userId)
    if (authMethods?.password) {
      const passwordResult = parseOrFail(passwordFieldSchema, passwordRaw)
      if (!passwordResult.success) {
        return ApiResponse.BAD_REQUEST('Password is required to delete your account.')
      }
      const valid = await verifyUserPasswordById(userId, passwordResult.data)
      if (!valid) return ApiResponse.BAD_REQUEST('Incorrect password.')
    }

    try {
      await teardownStripeBillingForUser(userId)
    } catch (error) {
      log.error('Stripe billing teardown failed — aborting account deletion', { userId, error })
      return ApiResponse.INTERNAL_ERROR(
        'We could not finish billing cleanup. Please try again shortly or contact support.',
      )
    }

    try {
      await deleteUserById(userId)
    } catch (error) {
      log.error('ACCOUNT_DELETE_PARTIAL_FAILURE', { userId, error }, 'billing teardown succeeded but user row deletion failed')
      return ApiResponse.INTERNAL_ERROR(
        'Billing was cleaned up, but account deletion failed. Please try again or contact support.',
      )
    }

    await signOut({ redirect: false })
    return ApiResponse.OK()
  })
}
