import { prisma } from '@/lib/infra/prisma'

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

export async function createVerificationTokenRecord(email: string, token: string): Promise<void> {
  const expires = new Date(Date.now() + TOKEN_TTL_MS)
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.verificationToken.create({ data: { identifier: email, token, expires } }),
  ])
}

export async function createPasswordResetTokenRecord(email: string, token: string): Promise<void> {
  const identifier = `password-reset:${email}`
  const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({ data: { identifier, token, expires } }),
  ])
}

export async function findPasswordResetTokenRecord(token: string) {
  return prisma.verificationToken.findUnique({ where: { token } })
}

export async function deleteVerificationToken(token: string): Promise<void> {
  await prisma.verificationToken.delete({ where: { token } })
}

export async function findLatestVerificationToken(email: string) {
  return prisma.verificationToken.findFirst({
    where: { identifier: email },
    orderBy: { expires: 'desc' },
  })
}
