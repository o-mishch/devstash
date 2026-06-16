import { createHash, randomBytes } from 'crypto'
import type { VerificationToken } from '@/generated/prisma'
import {
  createPasswordResetTokenRecord,
  createVerificationTokenRecord,
  deleteVerificationToken,
  findPasswordResetTokenRecord,
} from '@/lib/db/tokens'

export { TOKEN_TTL_MS } from '@/lib/db/tokens'

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * One-way hash for token storage at rest (Case 8). The raw token carries 256 bits of entropy, so a
 * fast SHA-256 is sufficient — we email the raw token but only ever store/look up its hash, so a
 * DB-read leak can't be replayed. Hex output keeps the `token` column's @unique constraint intact.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createVerificationToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await createVerificationTokenRecord(email, hashToken(token))
  return token
}

export async function createPasswordResetToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await createPasswordResetTokenRecord(email, hashToken(token))
  return token
}

interface ValidResetRecord {
  hashed: string
  record: VerificationToken
}

// Shared lookup gate for both peek and consume: hash the raw token, find the record, reject anything
// that isn't a live password-reset token, and delete-on-expiry. Returns the validated record (with
// its hash, so the caller can delete it on consume) or the reason it's unusable.
async function loadValidResetRecord(
  token: string,
): Promise<'invalid' | 'expired' | ValidResetRecord> {
  const hashed = hashToken(token)
  const record = await findPasswordResetTokenRecord(hashed)

  if (!record || !record.identifier.startsWith('password-reset:')) return 'invalid'
  if (record.expires < new Date()) {
    await deleteVerificationToken(hashed)
    return 'expired'
  }

  return { hashed, record }
}

export async function peekPasswordResetToken(
  token: string,
): Promise<'valid' | 'invalid' | 'expired'> {
  const result = await loadValidResetRecord(token)
  return typeof result === 'string' ? result : 'valid'
}

export async function consumePasswordResetToken(
  token: string,
): Promise<{ email: string } | null> {
  const result = await loadValidResetRecord(token)
  if (typeof result === 'string') return null

  await deleteVerificationToken(result.hashed)

  const email = result.record.identifier.replace('password-reset:', '')
  return { email }
}
