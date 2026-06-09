import { randomBytes } from 'crypto'
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

export async function createVerificationToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await createVerificationTokenRecord(email, token)
  return token
}

export async function createPasswordResetToken(email: string): Promise<string> {
  const token = generateSecureToken()
  await createPasswordResetTokenRecord(email, token)
  return token
}

export async function peekPasswordResetToken(
  token: string,
): Promise<'valid' | 'invalid' | 'expired'> {
  const record = await findPasswordResetTokenRecord(token)

  if (!record || !record.identifier.startsWith('password-reset:')) return 'invalid'
  if (record.expires < new Date()) {
    await deleteVerificationToken(token)
    return 'expired'
  }

  return 'valid'
}

export async function consumePasswordResetToken(
  token: string,
): Promise<{ email: string } | null> {
  const record = await findPasswordResetTokenRecord(token)

  if (!record || !record.identifier.startsWith('password-reset:')) return null
  if (record.expires < new Date()) {
    await deleteVerificationToken(token)
    return null
  }

  await deleteVerificationToken(token)

  const email = record.identifier.replace('password-reset:', '')
  return { email }
}
