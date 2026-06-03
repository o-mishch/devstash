import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'



export async function getUserSessionInfo(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, password: true } })
}

export async function createUser(data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput) {
  return prisma.user.create({ data })
}

export async function getUserWithGithubAccount(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      accounts: {
        where: { provider: 'github' },
        select: { id: true },
      },
    },
  })
}

export async function getUserAuthInfoByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, image: true, password: true, emailVerified: true },
  })
}

export async function getUserAuthMethods(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      password: true,
      accounts: { select: { id: true } },
    },
  })
}

export async function getUserEmailVerified(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true }
  })
}

export async function deleteUserById(id: string) {
  return prisma.user.delete({ where: { id } })
}

export async function checkAccountExists(accountId: string, userId: string) {
  return prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true }
  })
}

export async function checkProviderAccountExists(provider: string, providerAccountId: string) {
  return prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    select: { id: true },
  })
}

export async function createAccount(data: Prisma.AccountCreateInput | Prisma.AccountUncheckedCreateInput) {
  return prisma.account.create({ data })
}

export async function getVerificationToken(token: string) {
  return prisma.verificationToken.findUnique({ where: { token } })
}

export async function deleteVerificationToken(token: string) {
  return prisma.verificationToken.delete({ where: { token } })
}

export async function verifyUserEmailAndToken(email: string, token: string) {
  return prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ])
}

export async function updateUserPassword(userId: string, hashed: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  })
}

export async function unlinkUserAccount(userId: string, accountId: string): Promise<void> {
  await prisma.account.delete({ where: { id: accountId, userId } })
}
