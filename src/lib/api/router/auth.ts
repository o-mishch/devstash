import 'server-only'
import { ORPCError } from '@orpc/server'
import { signIn } from '@/auth'
import { AuthError } from 'next-auth'
import { pub } from '../orpc'
import { enforceRateLimit } from '../middleware'
import { getActionIP } from '@/lib/infra/rate-limit'
import { emailVerificationEnabled, resendVerification } from '@/lib/emails/verification'
import { getUserEmailVerified } from '@/lib/db/users'
import { registerUser, triggerPasswordReset, applyPasswordReset } from '@/lib/auth/auth-service'

export const authRouter = {
  login: pub.auth.login.handler(async ({ input, context, errors }) => {
    const { email, password } = input

    if (emailVerificationEnabled()) {
      const user = await getUserEmailVerified(email)
      if (user && !user.emailVerified) {
        throw errors.EMAIL_NOT_VERIFIED({ message: 'Please verify your email before signing in.', data: { email } })
      }
    }

    try {
      await signIn('credentials', { email, password, redirect: false })
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.type === 'CredentialsSignin') {
          // Only count failed attempts — successful logins must not consume the budget.
          await enforceRateLimit('login', `${await getActionIP()}:${email}`, context.resHeaders)
          throw new ORPCError('BAD_REQUEST', { message: 'Invalid email or password.' })
        }
        throw new ORPCError('BAD_REQUEST', { message: 'Something went wrong. Please try again.' })
      }
      throw error
    }
  }),

  register: pub.auth.register.handler(async ({ input, context }) => {
    await enforceRateLimit('register', await getActionIP(), context.resHeaders)
    const verification = await registerUser(input.name, input.email, input.password)

    if (verification === 'skipped') {
      return { redirectTo: '/sign-in' }
    }
    return {
      redirectTo: `/register?pending=1&email=${encodeURIComponent(input.email)}&sent=${verification === 'sent' ? '1' : '0'}`,
    }
  }),

  forgotPassword: pub.auth.forgotPassword.handler(async ({ input, context }) => {
    await enforceRateLimit('forgotPassword', await getActionIP(), context.resHeaders)
    await triggerPasswordReset(input.email)
    return { redirectTo: `/forgot-password?sent=1&email=${encodeURIComponent(input.email)}` }
  }),

  resetPassword: pub.auth.resetPassword.handler(async ({ input, context }) => {
    await enforceRateLimit('resetPassword', await getActionIP(), context.resHeaders)
    const result = await applyPasswordReset(input.token, input.password)
    if (result !== 'ok') {
      throw new ORPCError('BAD_REQUEST', { message: 'This reset link is invalid or has expired.' })
    }
  }),

  resendVerification: pub.auth.resendVerification.handler(async ({ input, context }) => {
    const ip = await getActionIP()
    // Broad IP-only guard — separate bucket, does not consume per-email quota.
    await enforceRateLimit('resendVerificationIP', ip, context.resHeaders)
    // Tighter per-IP+email guard for the actual send.
    await enforceRateLimit('resendVerification', `${ip}:${input.email}`, context.resHeaders)
    await resendVerification(input.email)
  }),
}
