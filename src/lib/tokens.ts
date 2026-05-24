import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export async function createVerificationToken(email: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.verificationToken.create({ data: { identifier: email, token, expires } }),
  ])

  return token
}
