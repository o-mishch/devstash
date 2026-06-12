import 'server-only'

import { prisma } from '@/lib/infra/prisma'
import type { Prisma } from '@/generated/prisma'

export async function getUserSessionInfo(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      password: true,
      isPro: true,
      stripeSubscriptionId: true,
      stripeLastSyncAt: true,
    },
  })
}

export async function createUser(data: Prisma.UserCreateInput | Prisma.UserUncheckedCreateInput) {
  return prisma.user.create({ data })
}

// Returns the user if they exist but haven't linked the given OAuth provider yet.
// Returns null if no user with that email exists, or they already have the provider linked.
// Matches on User.email OR any linked Account.email so that a user whose primary email
// differs from their OAuth provider email is still detected as a conflict.
export async function getUserWithOAuthConflict(email: string, provider: string) {
  return prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { accounts: { some: { email } } },
      ],
      accounts: { none: { provider } },
    },
    select: { id: true, email: true, password: true },
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
      accounts: { select: { id: true, provider: true } },
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

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
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

// Returns the account with its owning userId so callers can detect cross-user conflicts.
export async function getProviderAccount(provider: string, providerAccountId: string) {
  return prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    select: { id: true, userId: true },
  })
}

export async function createAccount(data: Prisma.AccountCreateInput | Prisma.AccountUncheckedCreateInput) {
  return prisma.account.create({ data })
}

export async function getVerificationToken(token: string) {
  return prisma.verificationToken.findUnique({
    where: { token },
    select: { identifier: true, token: true, expires: true },
  })
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

export async function removeUserPassword(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { password: null } })
}

/** Backfills OAuth account email when PrismaAdapter leaves it null. */
export async function backfillOAuthAccountEmail(
  provider: string,
  providerAccountId: string,
  email: string,
): Promise<void> {
  await prisma.account.updateMany({
    where: {
      provider,
      providerAccountId,
      email: null,
    },
    data: { email },
  })
}
