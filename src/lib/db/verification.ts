import { prisma } from '@/lib/infra/prisma'

export async function findUnverifiedUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true },
  })
}
