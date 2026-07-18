import { z } from 'zod'

/**
 * Client-side validation schemas for the auth forms. These MIRROR the backend's rules
 * for fast inline feedback — the Go API remains the source of truth and re-validates
 * every request. Zod v4 top-level string formats (`z.email`) over the deprecated
 * `z.string().email()` chain.
 */

const email = z.email('Enter a valid email address')
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')

interface PasswordConfirmation {
  password: string
  confirmPassword: string
}

// Cross-field match. The predicate is shared rather than retyped per schema — it is one
// character away from being inverted in a copy-paste, and both call sites would still
// compile. The message is attached to `confirmPassword` so the error renders under it.
const passwordsMatch = (v: PasswordConfirmation): boolean => v.password === v.confirmPassword
const passwordsMatchError = {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
}

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name'),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, passwordsMatchError)

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, passwordsMatchError)

export const forgotPasswordSchema = z.object({ email })

export const resendVerificationSchema = z.object({ email })

export const linkAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
})
