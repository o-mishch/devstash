import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export interface LinkedAccount {
  id: string
  provider: string
}

export interface ProfileUser {
  id: string
  name: string | null
  email: string
  image: string | null
  hasPassword: boolean
  accounts: LinkedAccount[]
  createdAt: Date
}

export interface ProfileStats {
  totalItems: number
  totalCollections: number
  itemTypeCounts: ItemTypeCount[]
}

export interface ItemTypeCount {
  name: string
  icon: string
  color: string
  count: number
}

const SYSTEM_TYPE_ORDER = ['snippet', 'prompt', 'command', 'note', 'link', 'file', 'image']

export async function getProfileData(): Promise<{ user: ProfileUser; stats: ProfileStats } | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

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
    .sort((a, b) => SYSTEM_TYPE_ORDER.indexOf(a.name) - SYSTEM_TYPE_ORDER.indexOf(b.name))

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
    stats: {
      totalItems,
      totalCollections,
      itemTypeCounts,
    },
  }
}
