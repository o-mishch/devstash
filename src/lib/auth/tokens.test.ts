import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/lib/db/tokens', () => ({
  TOKEN_TTL_MS: 24 * 60 * 60 * 1000,
  createPasswordResetTokenRecord: vi.fn(),
  createVerificationTokenRecord: vi.fn(),
  deleteVerificationToken: vi.fn(),
  findPasswordResetTokenRecord: vi.fn(),
}))

import {
  hashToken,
  createPasswordResetToken,
  createVerificationToken,
  consumePasswordResetToken,
  peekPasswordResetToken,
} from './tokens'
import {
  createPasswordResetTokenRecord,
  createVerificationTokenRecord,
  deleteVerificationToken,
  findPasswordResetTokenRecord,
} from '@/lib/db/tokens'

const mockCreatePasswordReset = createPasswordResetTokenRecord as ReturnType<typeof vi.fn>
const mockCreateVerification = createVerificationTokenRecord as ReturnType<typeof vi.fn>
const mockDelete = deleteVerificationToken as ReturnType<typeof vi.fn>
const mockFindReset = findPasswordResetTokenRecord as ReturnType<typeof vi.fn>

const sha = (t: string) => createHash('sha256').update(t).digest('hex')

beforeEach(() => vi.clearAllMocks())

describe('token hashing at rest (Case 8)', () => {
  it('hashToken is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(sha('abc'))
    expect(hashToken('abc')).toHaveLength(64)
  })

  it('createPasswordResetToken stores the hash but returns the raw token', async () => {
    const raw = await createPasswordResetToken('user@example.com')
    expect(mockCreatePasswordReset).toHaveBeenCalledWith('user@example.com', sha(raw))
    expect(raw).not.toBe(sha(raw)) // emailed value ≠ stored value
  })

  it('createVerificationToken stores the hash but returns the raw token', async () => {
    const raw = await createVerificationToken('user@example.com')
    expect(mockCreateVerification).toHaveBeenCalledWith('user@example.com', sha(raw))
    expect(raw).not.toBe(sha(raw))
  })

  it('consumePasswordResetToken looks up by the hash of the raw token and succeeds', async () => {
    const raw = 'raw-token-from-url'
    const record = { identifier: 'password-reset:user@example.com', expires: new Date(Date.now() + 10_000), token: sha(raw) }
    mockFindReset.mockImplementation((t: string) => (t === sha(raw) ? record : null))

    const result = await consumePasswordResetToken(raw)
    expect(mockFindReset).toHaveBeenCalledWith(sha(raw))
    expect(result).toEqual({ email: 'user@example.com' })
    expect(mockDelete).toHaveBeenCalledWith(sha(raw)) // single-use delete by hash
  })

  it('a lookup using the stored hash as the token fails (it gets re-hashed)', async () => {
    const raw = 'raw-token-from-url'
    const record = { identifier: 'password-reset:user@example.com', expires: new Date(Date.now() + 10_000), token: sha(raw) }
    mockFindReset.mockImplementation((t: string) => (t === sha(raw) ? record : null))

    // Passing the stored hash as if it were the token hashes it again → no match.
    expect(await consumePasswordResetToken(sha(raw))).toBeNull()
  })

  it('rejects and deletes an expired token (expiry still enforced)', async () => {
    const raw = 'raw-token-from-url'
    mockFindReset.mockResolvedValue({ identifier: 'password-reset:user@example.com', expires: new Date(Date.now() - 1), token: sha(raw) })

    expect(await consumePasswordResetToken(raw)).toBeNull()
    expect(mockDelete).toHaveBeenCalledWith(sha(raw))
  })

  it('peekPasswordResetToken validates by hash without consuming', async () => {
    const raw = 'raw-token-from-url'
    mockFindReset.mockResolvedValue({ identifier: 'password-reset:user@example.com', expires: new Date(Date.now() + 10_000), token: sha(raw) })

    expect(await peekPasswordResetToken(raw)).toBe('valid')
    expect(mockFindReset).toHaveBeenCalledWith(sha(raw))
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
