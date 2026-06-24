import { z } from 'zod'
import {
  NameSchema,
  EmailSchema,
  passwordFieldSchema,
  optionalPasswordMatchRefine,
  changePasswordSchema,
  editorPreferencesSchema,
} from '@/lib/utils/validators'

// Request schemas for the profile endpoints (oRPC `oc.route()` wrappers stripped — bare Zod). [C].

export const profileContextSchema = z
  .object({
    name: z.string().nullable(),
    email: z.string(),
    image: z.string().nullable(),
    hasPassword: z.boolean(),
    credentialEmail: z.string().nullable(),
    credentialEmailVerified: z.boolean(),
    isPro: z.boolean(),
    createdAt: z.string(),
    accounts: z.array(
      z.object({ id: z.string(), provider: z.string(), email: z.string().nullable() }),
    ),
    accountTypes: z.array(z.string()),
    availableEmails: z.array(z.string()),
    verificationDisabled: z.boolean(),
    stats: z.object({
      totalItems: z.number(),
      totalCollections: z.number(),
      itemTypeCounts: z.array(
        z.object({ name: z.string(), icon: z.string(), color: z.string(), count: z.number() }),
      ),
    }),
  })
  .meta({ id: 'ProfileContext' })

export type ProfileContextResponse = z.infer<typeof profileContextSchema>

// `password` is optional — only required when the user has a password set; the handler enforces that
// conditionally (matches the legacy loosely-parsed body).
export const optionalPasswordInput = z.object({ password: z.string().optional() })

export const updateNameInput = z.object({ name: NameSchema })

export const editorPreferencesInput = editorPreferencesSchema
export const editorPreferencesResponse = editorPreferencesSchema
export type EditorPreferencesResponse = z.infer<typeof editorPreferencesResponse>

export const userProfileFlagsSchema = z
  .object({
    isPro: z.boolean(),
    canCreateItem: z.boolean(),
    canCreateCollection: z.boolean(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
  })
  .meta({ id: 'UserProfileFlags' })
export type UserProfileFlagsResponse = z.infer<typeof userProfileFlagsSchema>

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
