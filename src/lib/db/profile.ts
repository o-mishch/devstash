import { prisma } from '@/lib/prisma'
import { withCache, CacheKeys } from '@/lib/redis-cache'
import { compareBySystemTypeOrder } from './items'
import { invalidateProfileCache } from '@/lib/cache'

export interface LinkedAccount {
  id: string
  provider: string
}

interface ProfileUser {
  id: string
  name: string | null
  email: string
  image: string | null
  hasPassword: boolean
  accounts: LinkedAccount[]
  createdAt: Date
}

interface ProfileStats {
  totalItems: number
  totalCollections: number
  itemTypeCounts: ItemTypeCount[]
}

interface ItemTypeCount {
  name: string
  icon: string
  color: string
  count: number
}

type ProfileData = { user: ProfileUser; stats: ProfileStats }

async function fetchProfileData(userId: string): Promise<ProfileData | null> {
  const [user, totalItems, totalCollections, itemTypes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        password: true,
        createdAt: true,
        accounts: { select: { id: true, provider: true } },
      },
    }),
    prisma.item.count({ where: { userId } }),
    prisma.collection.count({ where: { userId } }),
    prisma.itemType.findMany({
      where: { isSystem: true, userId: null },
      include: { _count: { select: { items: { where: { userId } } } } },
    }),
  ])

  if (!user) return null

  const itemTypeCounts: ItemTypeCount[] = itemTypes
    .map((t) => ({
      name: t.name,
      icon: t.icon,
      color: t.color,
      count: t._count.items,
    }))
    .sort(compareBySystemTypeOrder)

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      hasPassword: !!user.password,
      accounts: user.accounts.map((a) => ({ id: a.id, provider: a.provider })),
      createdAt: user.createdAt,
    },
    stats: { totalItems, totalCollections, itemTypeCounts },
  }
}

export async function getProfileData(userId: string): Promise<ProfileData | null> {
  return withCache(
    CacheKeys.profile(userId),
    () => fetchProfileData(userId)
  )
}

export async function updateUserPassword(userId: string, hashed: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  })
  await invalidateProfileCache(userId)
}

export async function unlinkUserAccount(userId: string, accountId: string): Promise<void> {
  await prisma.account.delete({ where: { id: accountId } })
  await invalidateProfileCache(userId)
}
