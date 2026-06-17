import { z } from 'zod'
import {
  NameSchema,
  EmailSchema,
  passwordFieldSchema,
  optionalPasswordMatchRefine,
  changePasswordSchema,
  editorPreferencesSchema,
} from '@/lib/utils/validators'

// Request schemas for the profile endpoints (oRPC `oc.route()` wrappers stripped — bare Zod). All
// profile mutations return 204 No Content, so there are no response schemas. [C].

// `password` is optional — only required when the user has a password set; the handler enforces that
// conditionally (matches the legacy loosely-parsed body).
export const optionalPasswordInput = z.object({ password: z.string().optional() })

export const updateNameInput = z.object({ name: NameSchema })

export const editorPreferencesInput = editorPreferencesSchema

export const changePasswordInput = changePasswordSchema

export const updateMainEmailInput = z.object({ email: EmailSchema, password: z.string().optional() })

export const accountIdParam = z.object({ id: z.string().trim().min(1, 'Account is required.') })

// Request a separate credential-login email. Normally only the address is collected — the password is
// chosen on the confirmation page once ownership is proven. When DISABLE_EMAIL_VERIFICATION is on, the
// dialog also collects the password up front so the server can activate the login instantly (no link);
// `newPassword`/`confirmPassword` are therefore optional and validated only when present.
export const requestCredentialEmailInput = z
  .object({
    email: EmailSchema,
    // Current password — required by the server for a CHANGE (re-pointing an existing sign-in email),
    // re-authenticating a sensitive change just like the default-email change. A first-time ADD has no
    // password yet, so it is omitted there.
    password: z.string().optional(),
    newPassword: passwordFieldSchema.optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine(optionalPasswordMatchRefine('newPassword'))
