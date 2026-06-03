import { z, ZodType } from 'zod'
import type { ApiBody } from '@/types/api'
import { EDITOR_THEMES, APP_THEMES } from '@/types/editor-preferences'

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: ApiBody<null> }

export function parseOrFail<T>(schema: ZodType<T>, input: unknown): ParseResult<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      response: {
        status: 'validation_error',
        data: null,
        message: parsed.error.issues[0]?.message ?? 'Validation failed',
      },
    }
  }
  return { success: true, data: parsed.data }
}

export const MAX_PASSWORD_LENGTH = 128

export function validatePassword(password: string, confirmPassword?: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.'
  if (confirmPassword !== undefined && password !== confirmPassword) return 'Passwords do not match.'
  return null
}

export const collectionFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  description: z.string().trim().max(500, 'Description is too long').optional().nullable().transform((v) => v || null),
})

export const itemFormBaseSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  content: z.string().optional(),
  url: z.string().optional(),
  language: z.string().optional(),
  tags: z.string().optional(),
  collectionIds: z.array(z.string()),
})

export type ItemFormBaseValues = z.infer<typeof itemFormBaseSchema>

export const editorPreferencesSchema = z.object({
  fontSize: z.number().min(8).max(100),
  tabSize: z.number().min(1).max(16),
  wordWrap: z.enum(['on', 'off']),
  minimap: z.boolean(),
  theme: z.enum(EDITOR_THEMES),
  appTheme: z.enum(APP_THEMES),
})
