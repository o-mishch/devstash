import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

export async function createVerificationToken(email: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.verificationToken.create({ data: { identifier: email, token, expires } }),
  ])

  return token
}

export async function createPasswordResetToken(email: string): Promise<string> {
  const identifier = `password-reset:${email}`
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS)

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({ data: { identifier, token, expires } }),
  ])

  return token
}

export async function peekPasswordResetToken(
  token: string
): Promise<'valid' | 'invalid' | 'expired'> {
  const record = await prisma.verificationToken.findUnique({ where: { token } })

  if (!record || !record.identifier.startsWith('password-reset:')) return 'invalid'
  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } })
    return 'expired'
  }

  return 'valid'
}

export async function consumePasswordResetToken(
  token: string
): Promise<{ email: string } | null> {
  const record = await prisma.verificationToken.findUnique({ where: { token } })

  if (!record || !record.identifier.startsWith('password-reset:')) return null
  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } })
    return null
  }

  await prisma.verificationToken.delete({ where: { token } })

  const email = record.identifier.replace('password-reset:', '')
  return { email }
}
