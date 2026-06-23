import { z, ZodType } from 'zod'
import type { ActionState } from '@/types/actions'
import { APP_THEMES, UI_SKINS } from '@/types/editor-preferences'
import { ITEM_TYPES_WITH_URL, ITEM_TYPES_WITH_FILE, ITEM_DESCRIPTION_MAX_CHARS } from '@/lib/utils/constants'

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: ActionState }

export function parseOrFail<T>(schema: ZodType<T>, input: unknown): ParseResult<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      response: {
        success: false,
        message: parsed.error.issues[0]?.message ?? 'Validation failed',
      },
    }
  }
  return { success: true, data: parsed.data }
}

export const MAX_PASSWORD_LENGTH = 128

/** Login / link-account password field — min 1 (presence), max 128 (bcrypt DoS guard). */
export const loginPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .max(MAX_PASSWORD_LENGTH, 'Password is too long.')

export const validatePassword = (password: string, confirmPassword?: string): string | null => {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.'
  if (confirmPassword !== undefined && password !== confirmPassword) return 'Passwords do not match.'
  return null
}

/** `superRefine` callback that validates `passwordField` against `confirmPassword`, attaching any error to `passwordField`. */
export const passwordMatchRefine =
  <K extends string>(passwordField: K) =>
  (data: Record<K, string> & { confirmPassword: string }, ctx: z.RefinementCtx) => {
    const error = validatePassword(data[passwordField], data.confirmPassword)
    if (error) ctx.addIssue({ code: 'custom', message: error, path: [passwordField] })
  }

/**
 * `superRefine` callback for an OPTIONAL password field — checks `passwordField` against
 * `confirmPassword` only when it's present, attaching any mismatch to `confirmPassword`. Used by the
 * credential-email add/confirm schemas, where the password is supplied only on the instant-activation
 * (verification-off) path.
 */
export const optionalPasswordMatchRefine =
  <K extends string>(passwordField: K) =>
  (data: Partial<Record<K, string>> & { confirmPassword?: string }, ctx: z.RefinementCtx) => {
    const password = data[passwordField]
    if (password !== undefined && password !== data.confirmPassword) {
      ctx.addIssue({ code: 'custom', message: 'Passwords do not match.', path: ['confirmPassword'] })
    }
  }

export const EmailSchema = z.email('Please enter a valid email address.').trim().toLowerCase()

export const collectionFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().trim().max(500, 'Description is too long').optional().nullable().transform((v) => v || null),
})

/**
 * Optional URL field for item forms: an empty string passes (per-type presence is enforced in the
 * create/edit forms for link items), but any non-empty value must look like a URL rather than a
 * plain string.
 */
export const optionalUrlSchema = z.union([z.literal(''), z.url('Must be a valid URL')])

export const itemFormBaseSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  content: z.string().optional(),
  url: optionalUrlSchema.optional(),
  language: z.string().optional(),
  tags: z.string().optional(),
  collectionIds: z.array(z.string()),
})

export type ItemFormBaseValues = z.infer<typeof itemFormBaseSchema>

export const itemMutationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().max(ITEM_DESCRIPTION_MAX_CHARS, 'Description is too long').optional().nullable().transform((v) => v || null),
  content: z.string().optional().nullable().transform((v) => v || null),
  url: z.union([z.string().trim().pipe(z.url('Must be a valid URL')), z.literal('')]).optional().nullable().transform((v) => v || null),
  language: z.string().trim().optional().nullable().transform((v) => v || null),
  tags: z.array(z.string().trim().min(1)).default([]),
  collectionIds: z.array(z.string()).default([]),
  // v3 live type change: optionally re-type an item among the four text types. Server-side allow-list
  // (link/file/image rejected — lossy). Omit to leave the type unchanged.
  itemTypeName: z.enum(['snippet', 'prompt', 'command', 'note']).optional(),
})

export type UpdateItemInput = z.infer<typeof itemMutationSchema>

export const createItemSchema = itemMutationSchema.extend({
  itemTypeName: z.string().trim().min(1, 'Type is required'),
  fileUrl: z.string().trim().optional().nullable().transform((v) => v || null),
  imageWidth: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
  imageHeight: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
}).refine((data) => {
  if (ITEM_TYPES_WITH_URL.has(data.itemTypeName) && !data.url) return false
  return true
}, {
  message: 'URL is required for links',
  path: ['url'],
}).refine((data) => {
  if (ITEM_TYPES_WITH_FILE.has(data.itemTypeName) && !data.fileUrl) return false
  return true
}, {
  message: 'A file must be uploaded for this type',
  path: ['fileUrl'],
})

export type CreateItemInput = z.input<typeof createItemSchema>

export const NameSchema = z.string().trim().min(1, 'Name is required.').max(64, 'Name is too long.')

export const passwordFieldSchema = z.string().trim().min(1, 'All fields are required.').max(MAX_PASSWORD_LENGTH, 'Password is too long.')

export const changePasswordSchema = z.object({
  currentPassword: passwordFieldSchema,
  newPassword: passwordFieldSchema,
  confirmPassword: passwordFieldSchema,
}).superRefine(passwordMatchRefine('newPassword'))

export const editorPreferencesSchema = z.object({
  fontSize: z.number().min(8).max(100),
  tabSize: z.number().min(1).max(16),
  wordWrap: z.enum(['on', 'off']),
  minimap: z.boolean(),
  appTheme: z.enum(APP_THEMES),
  colorMode: z.enum(['light', 'dark']),
  editorThemeMode: z.enum(['app', 'auto', 'dark']),
  uiSkin: z.enum(UI_SKINS),
  sidebarCollapsed: z.boolean(),
})
