import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db/profile', () => ({ updateEditorPreferences: vi.fn() }))
vi.mock('@/lib/infra/cache', () => ({ invalidateProfileCache: vi.fn() }))

const { mockRateLimitRoute } = vi.hoisted(() => ({ mockRateLimitRoute: vi.fn() }))
vi.mock('@/lib/infra/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/infra/rate-limit')>('@/lib/infra/rate-limit')
  return { ...actual, rateLimitRoute: mockRateLimitRoute }
})

import { auth } from '@/auth'
import { updateEditorPreferences } from '@/lib/db/profile'
import { invalidateProfileCache } from '@/lib/infra/cache'
import { editorPreferencesSchema } from '@/lib/utils/validators'
import type { EditorPreferences } from '@/types/editor-preferences'
import { PATCH } from './route'

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

const RATE_LIMITED = { body: { status: 'too_many_requests', data: null, message: 'Too many attempts.' }, headers: {} }

async function patchPreferences(body: unknown = validPreferences) {
  const req = new NextRequest('http://localhost/api/profile/editor-preferences', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  const res = await PATCH(req, { params: Promise.resolve({}) })
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
  mockRateLimitRoute.mockResolvedValue(null)
})

// ─── editorPreferencesSchema ──────────────────────────────────────────────────

describe('editorPreferencesSchema', () => {
  it('accepts valid preferences', () => {
    expect(editorPreferencesSchema.safeParse(validPreferences).success).toBe(true)
  })

  it('rejects fontSize below minimum (8)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 7 }).success).toBe(false)
  })

  it('rejects fontSize above maximum (100)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 101 }).success).toBe(false)
  })

  it('accepts fontSize at boundaries (8, 100)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 8 }).success).toBe(true)
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, fontSize: 100 }).success).toBe(true)
  })

  it('rejects tabSize below minimum (1)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, tabSize: 0 }).success).toBe(false)
  })

  it('rejects tabSize above maximum (16)', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, tabSize: 17 }).success).toBe(false)
  })

  it('rejects invalid wordWrap value', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, wordWrap: 'auto' }).success).toBe(false)
  })

  it('accepts wordWrap "off"', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, wordWrap: 'off' }).success).toBe(true)
  })

  it('rejects invalid theme', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, theme: 'solarized' }).success).toBe(false)
  })

  it('accepts all valid themes', () => {
    for (const theme of ['vs-dark', 'monokai', 'github-dark'] as const) {
      expect(editorPreferencesSchema.safeParse({ ...validPreferences, theme }).success).toBe(true)
    }
  })

  it('rejects non-boolean minimap', () => {
    expect(editorPreferencesSchema.safeParse({ ...validPreferences, minimap: 'yes' }).success).toBe(false)
  })
})

// ─── PATCH /api/profile/editor-preferences ────────────────────────────────────

describe('PATCH /api/profile/editor-preferences', () => {
  it('returns unauthorized when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const result = await patchPreferences()
    expect(result.status).toBe('unauthorized')
    expect(mockUpdateEditorPreferences).not.toHaveBeenCalled()
  })

  it('returns too_many_requests when rate limited', async () => {
    mockRateLimitRoute.mockResolvedValue(RATE_LIMITED)
    const result = await patchPreferences()
    expect(result.status).toBe('too_many_requests')
    expect(mockUpdateEditorPreferences).not.toHaveBeenCalled()
  })

  it('returns validation_error when fontSize is out of range', async () => {
    const result = await patchPreferences({ ...validPreferences, fontSize: 999 })
    expect(result.status).toBe('validation_error')
    expect(mockUpdateEditorPreferences).not.toHaveBeenCalled()
  })

  it('returns validation_error when theme is invalid', async () => {
    const result = await patchPreferences({ ...validPreferences, theme: 'light' })
    expect(result.status).toBe('validation_error')
  })

  it('returns validation_error when wordWrap is invalid', async () => {
    const result = await patchPreferences({ ...validPreferences, wordWrap: 'auto' })
    expect(result.status).toBe('validation_error')
  })

  it('returns ok on success', async () => {
    const result = await patchPreferences()
    expect(result.status).toBe('ok')
  })

  it('calls updateEditorPreferences with the session userId and parsed preferences', async () => {
    await patchPreferences()
    expect(mockUpdateEditorPreferences).toHaveBeenCalledWith('user-1', validPreferences)
  })

  it('invalidates the profile cache on success', async () => {
    await patchPreferences()
    expect(mockInvalidateProfileCache).toHaveBeenCalledWith('user-1')
  })

  it('returns internal_error on unexpected DB failure', async () => {
    mockUpdateEditorPreferences.mockRejectedValue(new Error('DB down'))
    const result = await patchPreferences()
    expect(result.status).toBe('internal_error')
  })
})
