import { z } from 'zod'
import {
  NameSchema,
  EmailSchema,
  changePasswordSchema,
  setInitialPasswordSchema,
  changeCredentialEmailSchema,
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

export const setInitialPasswordInput = setInitialPasswordSchema

export const changeEmailInput = changeCredentialEmailSchema

export const updateMainEmailInput = z.object({ email: EmailSchema, password: z.string().optional() })

export const accountIdParam = z.object({ id: z.string().trim().min(1, 'Account is required.') })
