import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  NameSchema,
  EmailSchema,
  changePasswordSchema,
  setInitialPasswordSchema,
  changeCredentialEmailSchema,
  editorPreferencesSchema,
} from '@/lib/utils/validators'

// `password` is optional here — only required when the user has a password set; the handler
// enforces that conditionally (matches the legacy loosely-parsed body).
const optionalPassword = z.object({ password: z.string().optional() })

export const profileContract = {
  deleteAccount: oc
    .route({ method: 'DELETE', path: '/profile' })
    .input(optionalPassword),

  updateName: oc
    .route({ method: 'PATCH', path: '/profile/name' })
    .input(z.object({ name: NameSchema })),

  updateEditorPreferences: oc
    .route({ method: 'PATCH', path: '/profile/editor-preferences' })
    .input(editorPreferencesSchema),

  changePassword: oc
    .route({ method: 'PATCH', path: '/profile/password' })
    .input(changePasswordSchema),

  setInitialPassword: oc
    .route({ method: 'POST', path: '/profile/password' })
    .input(setInitialPasswordSchema),

  removeCredentials: oc
    .route({ method: 'DELETE', path: '/profile/credentials' })
    .input(optionalPassword),

  changeEmail: oc
    .route({ method: 'PATCH', path: '/profile/email' })
    .input(changeCredentialEmailSchema),

  updateMainEmail: oc
    .route({ method: 'PATCH', path: '/profile/main-email' })
    .input(z.object({ email: EmailSchema, password: z.string().optional() })),

  unlinkAccount: oc
    .route({ method: 'DELETE', path: '/profile/accounts/{id}' })
    .input(z.object({ id: z.string().trim().min(1, 'Account is required.') })),
}
