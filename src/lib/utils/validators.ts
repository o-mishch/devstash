import { z } from 'zod'

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
