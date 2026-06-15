import 'server-only'
import { ORPCError } from '@orpc/server'
import { signOut } from '@/auth'
import { authed } from '../orpc'
import { enforceRateLimit } from '../middleware'
import { ErrorMessage } from '../error-messages'
import { getUserAuthMethods, deleteUserById, removeUserPassword, checkAccountExists, unlinkUserAccount } from '@/lib/db/users'
import { updateUserName, updateEditorPreferences, getProfileData } from '@/lib/db/profile'
import { changeUserPassword } from '@/lib/auth/auth-service'
import { verifyPasswordFromBody, verifyPasswordOrFail, applyOwnedEmailChange, requireAuthMethods } from '@/lib/app/profile-helpers'
import { teardownStripeBillingForUser } from '@/lib/billing/lifecycle/stripe-billing-lifecycle'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'api-profile' })

export const profileRouter = {
  deleteAccount: authed.profile.deleteAccount.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('deleteAccount', userId, context.resHeaders)

    const authMethods = await getUserAuthMethods(userId)
    if (authMethods?.password) {
      await verifyPasswordFromBody(userId, input.password, 'Password is required to delete your account.')
    }

    try {
      await teardownStripeBillingForUser(userId)
    } catch (error) {
      log.error({ userId, err: error }, 'Stripe billing teardown failed — aborting account deletion')
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'We could not finish billing cleanup. Please try again shortly or contact support.',
      })
    }

    try {
      await deleteUserById(userId)
    } catch (error) {
      log.error({ userId, err: error }, 'ACCOUNT_DELETE_PARTIAL_FAILURE — billing teardown succeeded but user row deletion failed')
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Billing was cleaned up, but account deletion failed. Please try again or contact support.',
      })
    }

    await signOut({ redirect: false })
    log.info({ userId }, 'Account deleted')
  }),

  updateName: authed.profile.updateName.handler(async ({ input, context }) => {
    await enforceRateLimit('updateSettings', context.userId, context.resHeaders)
    await updateUserName(context.userId, input.name)
    invalidateProfileCache(context.userId)
  }),

  updateEditorPreferences: authed.profile.updateEditorPreferences.handler(async ({ input, context }) => {
    await enforceRateLimit('updateSettings', context.userId, context.resHeaders)
    await updateEditorPreferences(context.userId, input)
    invalidateProfileCache(context.userId)
  }),

  changePassword: authed.profile.changePassword.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changePassword', userId, context.resHeaders)
    await verifyPasswordOrFail(userId, input.currentPassword, 'Current password is incorrect or not set.')
    await changeUserPassword(userId, input.newPassword)
    log.info({ userId }, 'Password changed')
  }),

  setInitialPassword: authed.profile.setInitialPassword.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changePassword', userId, context.resHeaders)

    const user = await requireAuthMethods(userId)
    if (user.password) throw new ORPCError('CONFLICT', { message: 'You already have a password. Use Change Password instead.' })

    await applyOwnedEmailChange({
      userId,
      newEmail: input.email,
      notOwnedMessage: 'You can only use an email from one of your linked accounts.',
    })

    await changeUserPassword(userId, input.newPassword)
    invalidateProfileCache(userId)
    log.info({ userId }, 'Initial password set')
  }),

  removeCredentials: authed.profile.removeCredentials.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changeCredentials', userId, context.resHeaders)

    const user = await requireAuthMethods(userId)
    if (!user.password) throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.NO_PASSWORD_SET })
    if (user.accounts.length === 0) throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.CANNOT_REMOVE_ONLY_SIGN_IN_METHOD })

    await verifyPasswordFromBody(userId, input.password, 'Password is required to remove your password.')

    await removeUserPassword(userId)
    invalidateProfileCache(userId)
    log.info({ userId }, 'Credentials removed')
  }),

  changeEmail: authed.profile.changeEmail.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changeCredentials', userId, context.resHeaders)

    const user = await requireAuthMethods(userId)
    if (!user.password) throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.NO_PASSWORD_SET })

    await verifyPasswordOrFail(userId, input.password)

    await applyOwnedEmailChange({
      userId,
      newEmail: input.email,
      notOwnedMessage: 'You can only use an email from one of your linked accounts.',
    })

    log.info({ userId }, 'Credential email changed')
  }),

  updateMainEmail: authed.profile.updateMainEmail.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changeCredentials', userId, context.resHeaders)

    const data = await getProfileData(userId)
    if (!data) throw new ORPCError('UNAUTHORIZED', { message: ErrorMessage.NOT_AUTHENTICATED })

    if (data.user.hasPassword) {
      await verifyPasswordFromBody(userId, input.password, 'Password is required to change your sign-in email.')
    }

    await applyOwnedEmailChange({
      userId,
      newEmail: input.email,
      notOwnedMessage: 'You can only set an email from one of your linked accounts.',
    })

    log.info({ userId }, 'Main email updated')
  }),

  unlinkAccount: authed.profile.unlinkAccount.handler(async ({ input, context }) => {
    const { userId } = context
    await enforceRateLimit('changeCredentials', userId, context.resHeaders)

    const user = await requireAuthMethods(userId)

    const totalAuthMethods = (user.password ? 1 : 0) + user.accounts.length
    if (totalAuthMethods <= 1) throw new ORPCError('BAD_REQUEST', { message: ErrorMessage.CANNOT_REMOVE_ONLY_SIGN_IN_METHOD })

    const account = await checkAccountExists(input.id, userId)
    if (!account) throw new ORPCError('NOT_FOUND', { message: 'Account not found.' })

    await unlinkUserAccount(userId, input.id)
    invalidateProfileCache(userId)
    log.info({ userId, accountId: input.id }, 'Provider unlinked')
  }),
}
