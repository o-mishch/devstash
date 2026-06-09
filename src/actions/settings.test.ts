import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/profile', () => ({ updateEditorPreferences: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateProfileCache: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return {
    ...actual,
    rateLimitAction: vi.fn(async () => null),
  }
})

vi.mock('@/lib/billing/access/pro-access-resolution', () => ({
  getCachedVerifiedProAccess: vi.fn(async () => false),
}))

import { auth } from '@/auth'
import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { updateEditorPreferencesAction } from './settings'
import { editorPreferencesSchema } from '@/lib/utils/validators'
import type { EditorPreferences } from '@/types/editor-preferences'

const mockAuth = auth as ReturnType<typeof vi.fn>
const mockUpdateEditorPreferences = updateEditorPreferences as ReturnType<typeof vi.fn>
const mockInvalidateProfileCache = invalidateProfileCache as ReturnType<typeof vi.fn>

const validPreferences: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  minimap: false,
  theme: 'vs-dark',
  appTheme: 'vscode',
}

beforeEach(() => vi.clearAllMocks())

// ─── editorPreferencesSchema ──────────────────────────────────────────────────

describe('editorPreferencesSchema', () => {
  it('accepts valid preferences', () => {
    const result = editorPreferencesSchema.safeParse(validPreferences)
    expect(result.success).toBe(true)
  })

  it('rejects fontSize below minimum (8)', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 7 })
    expect(result.success).toBe(false)
  })

  it('rejects fontSize above maximum (100)', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 101 })
    expect(result.success).toBe(false)
  })

  it('accepts fontSize at boundaries (8, 100)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 8 }).success).toBe(true)
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 100 }).success).toBe(true)
  })

  it('rejects tabSize below minimum (1)', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, tabSize: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects tabSize above maximum (16)', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, tabSize: 17 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid wordWrap value', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, wordWrap: 'auto' })
    expect(result.success).toBe(false)
  })

  it('accepts wordWrap "off"', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, wordWrap: 'off' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid theme', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, theme: 'solarized' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid themes', () => {
    for (const theme of ['vs-dark', 'monokai', 'github-dark'] as const) {
      const result = editorPreferencesSchema.safeParse({ ...validPreferences, theme })
      expect(result.success).toBe(true)
    }
  })

  it('rejects non-boolean minimap', () => {
    const result = editorPreferencesSchema.safeParse({ ...validPreferences, minimap: 'yes' })
    expect(result.success).toBe(false)
  })
})

// ─── updateEditorPreferencesAction ───────────────────────────────────────────

describe('updateEditorPreferencesAction', () => {
  it('returns UNAUTHORIZED when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await updateEditorPreferencesAction(validPreferences)
    expect(result.status).toBe('unauthorized')
  })

  it('returns VALIDATION_ERROR when fontSize is out of range', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const result = await updateEditorPreferencesAction({ ...validPreferences, fontSize: 999 })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when theme is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    // @ts-expect-error testing invalid input
    const result = await updateEditorPreferencesAction({ ...validPreferences, theme: 'light' })
    expect(result.status).toBe('validation_error')
  })

  it('returns VALIDATION_ERROR when wordWrap is invalid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    // @ts-expect-error testing invalid input
    const result = await updateEditorPreferencesAction({ ...validPreferences, wordWrap: 'auto' })
    expect(result.status).toBe('validation_error')
  })

  it('returns OK on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateEditorPreferences.mockResolvedValue(undefined)
    mockInvalidateProfileCache.mockResolvedValue(undefined)

    const result = await updateEditorPreferencesAction(validPreferences)
    expect(result.status).toBe('ok')
  })

  it('calls updateEditorPreferences with userId and parsed preferences', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateEditorPreferences.mockResolvedValue(undefined)

    await updateEditorPreferencesAction(validPreferences)

    expect(mockUpdateEditorPreferences).toHaveBeenCalledWith('user-1', validPreferences)
  })

  it('invalidates the profile cache on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateEditorPreferences.mockResolvedValue(undefined)
    mockInvalidateProfileCache.mockResolvedValue(undefined)

    await updateEditorPreferencesAction(validPreferences)

    expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
  })

  it('does not call updateEditorPreferences when validation fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })

    await updateEditorPreferencesAction({ ...validPreferences, fontSize: 0 })

    expect(mockUpdateEditorPreferences).not.toHaveBeenCalled()
    expect(mockInvalidateProfileCache).not.toHaveBeenCalled()
  })

  it('returns INTERNAL_ERROR on unexpected DB failure', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockUpdateEditorPreferences.mockRejectedValue(new Error('DB down'))

    const result = await updateEditorPreferencesAction(validPreferences)
    expect(result.status).toBe('internal_error')
  })
})
