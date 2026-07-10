import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { generateSecureToken as GenerateSecureTokenFn, hashToken as HashTokenFn } from '@/lib/auth/tokens'

const store = new Map<string, unknown>()
// A minimal stand-in for the real `Redis` client — only the three methods `pending-link.ts`
// actually calls. The real `getRedis()` returns the full `@upstash/redis` `Redis` class (dozens
// of unrelated methods), so this fake is typed by what it honestly is (its own shape), not by
// pretending to satisfy the full SDK type.
const fakeRedis = {
  set: vi.fn<(key: string, value: unknown) => string>((key, value) => {
    store.set(key, value)
    return 'OK'
  }),
  get: vi.fn<(key: string) => unknown>((key) => store.get(key) ?? null),
  getdel: vi.fn<(key: string) => unknown>((key) => {
    const value = store.get(key) ?? null
    store.delete(key)
    return value
  }),
}

vi.mock('@/lib/infra/redis', () => ({
  getRedis: vi.fn<() => typeof fakeRedis>(() => fakeRedis),
}))

vi.mock('@/lib/auth/tokens', () => ({
  generateSecureToken: vi.fn<typeof GenerateSecureTokenFn>(() => 'test-token-abc'),
  hashToken: vi.fn<typeof HashTokenFn>((token: string) => `hashed-${token}`),
}))

import {
  createPendingLink,
  getPendingLink,
  consumePendingLink,
  createLinkIntent,
  getLinkIntent,
  consumeLinkIntent,
  type PendingLinkData,
} from './pending-link'

const pendingData: PendingLinkData = {
  email: 'user@example.com',
  providerEmail: 'oauth@example.com',
  provider: 'github',
  providerAccountId: 'gh-1',
  type: 'oauth',
  access_token: 'at',
  refresh_token: 'rt',
  expires_at: null,
  token_type: null,
  scope: null,
  id_token: null,
  session_state: null,
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('pending link lifecycle', () => {
  it('createPendingLink stores data retrievable by getPendingLink', async () => {
    const token = await createPendingLink(pendingData)
    expect(token).toBe('test-token-abc')
    expect(store.has('pending-link:test-token-abc')).toBe(false)
    expect(store.has('pending-link:hashed-test-token-abc')).toBe(true)
    expect(await getPendingLink('test-token-abc')).toEqual(pendingData)
  })

  it('consumePendingLink is single-use via getdel', async () => {
    await createPendingLink(pendingData)
    expect(await consumePendingLink('test-token-abc')).toEqual(pendingData)
    expect(await consumePendingLink('test-token-abc')).toBeNull()
    expect(await getPendingLink('test-token-abc')).toBeNull()
  })

  it('getPendingLink does not consume the token', async () => {
    await createPendingLink(pendingData)
    expect(await getPendingLink('test-token-abc')).toEqual(pendingData)
    expect(await getPendingLink('test-token-abc')).toEqual(pendingData)
  })
})

describe('link intent lifecycle', () => {
  it('createLinkIntent stores userId retrievable by getLinkIntent', async () => {
    const token = await createLinkIntent('user-1')
    expect(token).toBe('test-token-abc')
    expect(store.has('link-intent:test-token-abc')).toBe(false)
    expect(store.has('link-intent:hashed-test-token-abc')).toBe(true)
    expect(await getLinkIntent('test-token-abc')).toEqual({ userId: 'user-1' })
  })

  it('getLinkIntent does not consume the intent', async () => {
    await createLinkIntent('user-1')
    expect(await getLinkIntent('test-token-abc')).toEqual({ userId: 'user-1' })
    expect(await getLinkIntent('test-token-abc')).toEqual({ userId: 'user-1' })
  })

  it('consumeLinkIntent is single-use via getdel', async () => {
    await createLinkIntent('user-1')
    expect(await consumeLinkIntent('test-token-abc')).toEqual({ userId: 'user-1' })
    expect(await consumeLinkIntent('test-token-abc')).toBeNull()
    expect(await getLinkIntent('test-token-abc')).toBeNull()
  })
})
