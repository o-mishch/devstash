import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

// In-memory fake of the bits of the Upstash client the token module uses: set (with TTL), get, and
// the atomic getdel. Keyed by the exact string keys the module builds, so we assert hashing-at-rest
// by checking the raw token never appears as a key.
const store = new Map<string, unknown>()
const ttls = new Map<string, number | undefined>()
const fakeRedis = {
  set: vi.fn(async (key: string, value: unknown, options?: { ex?: number }) => {
    store.set(key, value)
    ttls.set(key, options?.ex)
    return 'OK'
  }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  del: vi.fn(async (key: string) => {
    store.delete(key)
    return 1
  }),
  incr: vi.fn(async (key: string) => {
    const next = (Number(store.get(key) ?? 0) + 1)
    store.set(key, next)
    return next
  }),
  expire: vi.fn(async (key: string, seconds: number) => {
    ttls.set(key, seconds)
    return 1
  }),
  getdel: vi.fn(async (key: string) => {
    const v = store.get(key) ?? null
    store.delete(key)
    return v
  }),
  eval: vi.fn(async (_script: string, keys: string[], args: (string | number)[]) => {
    const genKey = keys[0]
    const tokenKey = keys[1]
    const expectedGen = Number(args[0])
    const current = store.get(genKey)
    if (current === undefined || Number(current) !== expectedGen) return null
    const v = store.get(tokenKey) ?? null
    store.delete(tokenKey)
    return v
  }),
}

vi.mock('@/lib/infra/redis', () => ({
  getRedis: vi.fn(() => fakeRedis),
}))

import {
  hashToken,
  createPasswordResetToken,
  createVerificationToken,
  consumePasswordResetToken,
  peekPasswordResetToken,
  consumeVerificationToken,
  verificationRecentlySent,
  createCredentialEmailToken,
  deleteCredentialEmailToken,
  peekCredentialEmailPayload,
  consumeCredentialEmailToken,
} from './tokens'

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

beforeEach(() => {
  store.clear()
  ttls.clear()
  vi.clearAllMocks()
})

const expectTtl = (key: string, seconds: number) => {
  expect(ttls.get(key)).toBe(seconds)
}

describe('token hashing at rest', () => {
  it('hashToken is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(sha('abc'))
    expect(hashToken('abc')).toHaveLength(64)
  })

  it('createPasswordResetToken stores under the hash key, never the raw token', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    const key = `auth:password-reset:${sha(raw)}`
    expect(store.has(key)).toBe(true)
    expectTtl(key, 60 * 60)
    expect(store.has(`auth:password-reset:${raw}`)).toBe(false) // raw is never a key
    expect(raw).not.toBe(sha(raw))
  })

  it('createVerificationToken stores under the hash key and sets the anti-spam marker', async () => {
    const raw = await createVerificationToken('user@example.com')
    const tokenKey = `auth:verify-email:${sha(raw)}`
    const markerKey = 'auth:verify-sent:user@example.com'
    expect(store.has(tokenKey)).toBe(true)
    expectTtl(tokenKey, 60 * 60 * 24)
    expect(store.has(markerKey)).toBe(true)
    expectTtl(markerKey, 55 * 60)
  })
})

describe('password-reset token lifecycle', () => {
  it('consume looks up by hash of the raw token and returns the payload', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    expect(await consumePasswordResetToken(raw)).toEqual({ email: 'user@example.com' })
  })

  it('is single-use — a second consume returns null', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    expect(await consumePasswordResetToken(raw)).toEqual({ email: 'user@example.com' })
    expect(await consumePasswordResetToken(raw)).toBeNull()
  })

  it('passing the stored hash as the token fails (it gets re-hashed)', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    expect(await consumePasswordResetToken(sha(raw))).toBeNull()
  })

  it('peek validates by hash without consuming', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    expect(await peekPasswordResetToken(raw)).toBe('valid')
    expect(await peekPasswordResetToken(raw)).toBe('valid') // still present
    expect(await peekPasswordResetToken('nope')).toBe('invalid')
  })
})

describe('verification token lifecycle', () => {
  it('consume returns the email and is single-use', async () => {
    const raw = await createVerificationToken('user@example.com')
    expect(await consumeVerificationToken(raw)).toEqual({ email: 'user@example.com' })
    expect(await consumeVerificationToken(raw)).toBeNull()
  })

  it('verificationRecentlySent reflects the anti-spam marker', async () => {
    expect(await verificationRecentlySent('user@example.com')).toBe(false)
    await createVerificationToken('user@example.com')
    expect(await verificationRecentlySent('user@example.com')).toBe(true)
  })
})

describe('credential-email token lifecycle', () => {
  it('round-trips the userId + email + mode payload and is single-use', async () => {
    const raw = await createCredentialEmailToken('user-1', 'new@example.com', 'add')
    const key = `auth:credential-email:${sha(raw)}`
    expect(store.has(key)).toBe(true)
    expectTtl(key, 60 * 60)
    expect(await peekCredentialEmailPayload(raw)).toEqual({
      userId: 'user-1',
      email: 'new@example.com',
      mode: 'add',
      gen: 1,
    })
    expect(await consumeCredentialEmailToken(raw)).toEqual({
      userId: 'user-1',
      email: 'new@example.com',
      mode: 'add',
      gen: 1,
    })
    expect(await consumeCredentialEmailToken(raw)).toBeNull()
    expect(await peekCredentialEmailPayload(raw)).toBeNull()
  })

  it('peekCredentialEmailPayload returns the payload without consuming the token', async () => {
    const raw = await createCredentialEmailToken('user-1', 'new@example.com', 'change')
    expect(await peekCredentialEmailPayload(raw)).toEqual({
      userId: 'user-1',
      email: 'new@example.com',
      mode: 'change',
      gen: 1,
    })
    expect(await consumeCredentialEmailToken(raw)).toEqual({
      userId: 'user-1',
      email: 'new@example.com',
      mode: 'change',
      gen: 1,
    })
  })

  it('supersedes a prior token when a new one is requested for the same user', async () => {
    const first = await createCredentialEmailToken('user-1', 'first@example.com', 'add')
    const second = await createCredentialEmailToken('user-1', 'second@example.com', 'change')
    expect(await peekCredentialEmailPayload(first)).toBeNull()
    expect(await peekCredentialEmailPayload(second)).toEqual({
      userId: 'user-1',
      email: 'second@example.com',
      mode: 'change',
      gen: 2,
    })
    expect(store.get('auth:credential-email-gen:user-1')).toBe(2)
  })

  it('does not consume a superseded token even when the Redis key still exists', async () => {
    const raw = await createCredentialEmailToken('user-1', 'first@example.com', 'add')
    await createCredentialEmailToken('user-1', 'second@example.com', 'change')
    const tokenKey = `auth:credential-email:${sha(raw)}`
    expect(store.has(tokenKey)).toBe(true)
    expect(await consumeCredentialEmailToken(raw)).toBeNull()
    expect(store.has(tokenKey)).toBe(true)
  })

  it('deleteCredentialEmailToken removes the token without consuming it', async () => {
    const raw = await createCredentialEmailToken('user-1', 'new@example.com', 'add')
    const tokenKey = `auth:credential-email:${sha(raw)}`
    expect(store.has(tokenKey)).toBe(true)
    await deleteCredentialEmailToken(raw)
    expect(store.has(tokenKey)).toBe(false)
    expect(await peekCredentialEmailPayload(raw)).toBeNull()
  })
})
