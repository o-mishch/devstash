import { z } from 'zod'
import { EmailSchema, NameSchema, passwordFieldSchema, passwordMatchRefine, optionalPasswordMatchRefine, loginPasswordSchema } from '@/lib/utils/validators'

// Request/response schemas for the public auth endpoints (oRPC `oc.route()` wrappers stripped — bare
// Zod). These run before a session exists, so the routes use `publicRoute` (no session gate) and
// rate-limit inline by IP / IP+email. [C].

export const loginInput = z.object({
  email: EmailSchema,
  password: loginPasswordSchema,
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
  // EmailSchema trims + lowercases, matching how addresses are stored — a mixed-case input still resolves.
  email: EmailSchema,
})

// Confirm a credential-login email: the token (from the emailed link) proves ownership. For an ADD
// the password is chosen here (mirrors resetPasswordInput); for a CHANGE (re-pointing an existing
// login) no password is submitted, so both fields are optional and matched only when present. The
// server enforces password presence when the user's current account state is still an add path.
export const confirmLoginEmailInput = z
  .object({
    token: z.string().min(1, 'This confirmation link is invalid or has expired.'),
    password: passwordFieldSchema.optional(),
    confirmPassword: passwordFieldSchema.optional(),
  })
  .superRefine(optionalPasswordMatchRefine('password'))

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
