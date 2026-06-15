import { oc } from '@orpc/contract'
import { z } from 'zod'
import { EmailSchema, NameSchema, passwordFieldSchema, passwordMatchRefine } from '@/lib/utils/validators'
import { authRedirectSchema } from './common'

const registerInput = z
  .object({
    name: NameSchema,
    email: EmailSchema,
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

const resetPasswordInput = z
  .object({
    token: z.string().min(1, 'This reset link is invalid or has expired.'),
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

export const authContract = {
  // EMAIL_NOT_VERIFIED is a typed error so the client can read the unverified `email` and offer resend.
  login: oc
    .route({ method: 'POST', path: '/auth/login' })
    .input(z.object({ email: EmailSchema, password: z.string().min(1, 'Password is required.') }))
    .errors({ EMAIL_NOT_VERIFIED: { status: 403, data: z.object({ email: z.string() }) } }),

  register: oc
    .route({ method: 'POST', path: '/auth/register' })
    .input(registerInput)
    .output(authRedirectSchema),

  forgotPassword: oc
    .route({ method: 'POST', path: '/auth/forgot-password' })
    .input(z.object({ email: EmailSchema }))
    .output(authRedirectSchema),

  resetPassword: oc
    .route({ method: 'POST', path: '/auth/reset-password' })
    .input(resetPasswordInput),

  resendVerification: oc
    .route({ method: 'POST', path: '/auth/resend-verification' })
    .input(z.object({ email: z.string().trim().min(1, 'Email is required.') })),
}
