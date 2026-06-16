import { z } from 'zod'
import { EmailSchema, NameSchema, passwordFieldSchema, passwordMatchRefine } from '@/lib/utils/validators'

// Request/response schemas for the public auth endpoints (oRPC `oc.route()` wrappers stripped — bare
// Zod). These run before a session exists, so the routes use `publicRoute` (no session gate) and
// rate-limit inline by IP / IP+email. [C].

export const loginInput = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required.'),
})

export const registerInput = z
  .object({
    name: NameSchema,
    email: EmailSchema,
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

export const forgotPasswordInput = z.object({ email: EmailSchema })

export const resetPasswordInput = z
  .object({
    token: z.string().min(1, 'This reset link is invalid or has expired.'),
    password: passwordFieldSchema,
    confirmPassword: passwordFieldSchema,
  })
  .superRefine(passwordMatchRefine('password'))

export const resendVerificationInput = z.object({
  email: z.string().trim().min(1, 'Email is required.'),
})

// register / forgotPassword return a path the client navigates to after the flow.
export const authRedirectSchema = z.object({ redirectTo: z.string() }).meta({ id: 'AuthRedirect' })

// login's 403 carries the unverified `email` so the client can offer "resend verification". This is
// the one auth error with a structured `data` body — every other auth error is a bare `{ message }`,
// so `'data' in error` narrows to this shape on the client.
export const loginEmailNotVerifiedSchema = z
  .object({
    message: z.string(),
    data: z.object({ email: z.string() }),
  })
  .meta({ id: 'LoginEmailNotVerified' })
