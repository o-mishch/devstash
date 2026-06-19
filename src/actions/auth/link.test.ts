import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ delete: vi.fn() }),
}))

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type = ''
  }
  return { MockAuthError }
})

vi.mock('next-auth', () => ({ AuthError: MockAuthError }))
vi.mock('@/auth', () => ({
  signIn: vi.fn(),
  auth: vi.fn(),
  LINK_INTENT_COOKIE: 'devstash_link_token',
}))

vi.mock('@/lib/infra/rate-limit', () => ({
  withRateLimit: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  rateLimitAction: vi.fn().mockResolvedValue(null),
  getActionIP: vi.fn().mockResolvedValue('127.0.0.1'),
}))

vi.mock('@/lib/auth/pending-link', () => ({
  getPendingLink: vi.fn(),
  consumePendingLink: vi.fn(),
}))

vi.mock('@/lib/auth/auth-service', () => ({
  validateUserPassword: vi.fn(),
  linkPendingAccount: vi.fn(),
}))

import { signIn, auth } from '@/auth'
import { rateLimitAction } from '@/lib/infra/rate-limit'
import { getPendingLink, consumePendingLink } from '@/lib/auth/pending-link'
import { validateUserPassword, linkPendingAccount } from '@/lib/auth/auth-service'
import { linkAccountAction, autoLinkAccountAction } from './link'

const mockGetPendingLink = getPendingLink as ReturnType<typeof vi.fn>
const mockConsumePendingLink = consumePendingLink as ReturnType<typeof vi.fn>
const mockRateLimitAction = rateLimitAction as ReturnType<typeof vi.fn>
const mockValidateUserPassword = validateUserPassword as ReturnType<typeof vi.fn>
const mockLinkPendingAccount = linkPendingAccount as ReturnType<typeof vi.fn>
const mockSignIn = signIn as ReturnType<typeof vi.fn>
const mockAuth = auth as ReturnType<typeof vi.fn>

const pending = {
  email: 'user@example.com',
  providerEmail: null,
  provider: 'github',
  providerAccountId: 'gh-1',
  type: 'oauth',
  access_token: null,
  refresh_token: null,
  expires_at: null,
  token_type: null,
  scope: null,
  id_token: null,
  session_state: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPendingLink.mockResolvedValue(pending)
  mockConsumePendingLink.mockResolvedValue(pending)
  mockValidateUserPassword.mockResolvedValue({ id: 'u1', email: pending.email })
  mockLinkPendingAccount.mockResolvedValue(undefined)
  mockSignIn.mockResolvedValue(undefined)
  mockAuth.mockResolvedValue({ user: { id: 'u1', email: pending.email } })
})

describe('linkAccountAction', () => {
  it('returns validation_error when the password exceeds max length', async () => {
    const form = new FormData()
    form.set('password', 'a'.repeat(129))
    const result = await linkAccountAction('tok', null, form)
    expect(result.success).toBe(false)
    expect(mockGetPendingLink).not.toHaveBeenCalled()
  })

  it('returns bad_request when the token is missing or expired', async () => {
    mockGetPendingLink.mockResolvedValue(null)
    const form = new FormData()
    form.set('password', 'secret')
    const result = await linkAccountAction('tok', null, form)
    expect(result.success).toBe(false)
    expect(mockValidateUserPassword).not.toHaveBeenCalled()
  })

  it('does not consume the token when the password is wrong', async () => {
    mockValidateUserPassword.mockResolvedValue(null)
    const form = new FormData()
    form.set('password', 'wrong')
    const result = await linkAccountAction('tok', null, form)
    expect(result.success).toBe(false)
    expect(mockConsumePendingLink).not.toHaveBeenCalled()
    expect(mockLinkPendingAccount).not.toHaveBeenCalled()
  })

  it('links before consuming and signs in on success', async () => {
    mockSignIn.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    const form = new FormData()
    form.set('password', 'correct')
    await expect(linkAccountAction('tok', null, form)).rejects.toThrow('NEXT_REDIRECT')
    expect(mockLinkPendingAccount).toHaveBeenCalledBefore(mockConsumePendingLink)
    expect(mockConsumePendingLink).toHaveBeenCalledWith('tok')
    expect(mockSignIn).toHaveBeenCalledWith('credentials', {
      email: pending.email,
      password: 'correct',
      redirectTo: '/dashboard',
    })
  })

  it('does not consume the token when linking fails', async () => {
    mockLinkPendingAccount.mockRejectedValue(new Error('db down'))
    const form = new FormData()
    form.set('password', 'correct')
    await expect(linkAccountAction('tok', null, form)).rejects.toThrow('db down')
    expect(mockConsumePendingLink).not.toHaveBeenCalled()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('still signs in when consume after link is a no-op', async () => {
    mockConsumePendingLink.mockResolvedValue(null)
    mockSignIn.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    const form = new FormData()
    form.set('password', 'correct')
    await expect(linkAccountAction('tok', null, form)).rejects.toThrow('NEXT_REDIRECT')
    expect(mockSignIn).toHaveBeenCalled()
  })

  it('returns bad_request when signIn fails after link and consume', async () => {
    mockSignIn.mockRejectedValue(new MockAuthError())
    const form = new FormData()
    form.set('password', 'correct')
    const result = await linkAccountAction('tok', null, form)
    expect(result.success).toBe(false)
    expect(result.message).toContain('sign in')
    expect(mockLinkPendingAccount).toHaveBeenCalled()
    expect(mockConsumePendingLink).toHaveBeenCalled()
  })
})

describe('autoLinkAccountAction', () => {
  it('redirects when rate limited', async () => {
    mockRateLimitAction.mockResolvedValueOnce({
      success: false,
      message: 'Too many attempts.',
    })
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('REDIRECT:/profile?toast=rate_limited')
    expect(mockGetPendingLink).not.toHaveBeenCalled()
  })

  it('redirects to sign-in when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('REDIRECT:/sign-in')
  })

  it('redirects when the pending link is expired', async () => {
    mockGetPendingLink.mockResolvedValue(null)
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('REDIRECT:/profile?toast=expired')
    expect(mockLinkPendingAccount).not.toHaveBeenCalled()
    expect(mockConsumePendingLink).not.toHaveBeenCalled()
  })

  it('does not consume when linking fails', async () => {
    mockLinkPendingAccount.mockRejectedValue(new Error('db down'))
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('db down')
    expect(mockConsumePendingLink).not.toHaveBeenCalled()
  })

  it('consumes the token and redirects when the session email mismatches', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', email: 'other@example.com' } })
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('REDIRECT:/profile?toast=mismatch')
    expect(mockConsumePendingLink).toHaveBeenCalledWith('tok')
    expect(mockLinkPendingAccount).not.toHaveBeenCalled()
  })

  it('links then consumes on success', async () => {
    await expect(autoLinkAccountAction('tok')).rejects.toThrow('REDIRECT:/profile?toast=linked')
    expect(mockLinkPendingAccount).toHaveBeenCalledBefore(mockConsumePendingLink)
    expect(mockConsumePendingLink).toHaveBeenCalledWith('tok')
  })
})
