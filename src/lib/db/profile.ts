import { prisma } from '@/lib/infra/prisma'
import { withDataCache, CacheTags } from '@/lib/infra/cache'
import { compareBySystemTypeOrder, PROVIDER_LABELS } from '@/lib/utils/constants'
import type { EditorPreferences } from '@/types/editor-preferences'
import type { Prisma } from '@/generated/prisma/client'

export interface LinkedAccount {
  id: string
  provider: string
  email: string | null
}

interface ProfileUser {
  id: string
  name: string | null
  email: string
  image: string | null
  hasPassword: boolean
  editorPreferences: EditorPreferences | null
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

export interface ProfileAccountSummary {
  accountTypes: string[]
  availableEmails: string[]
}

/** Derives sign-in method labels and deduped owned emails for profile UI. */
export function getProfileAccountSummary(user: Pick<ProfileUser, 'email' | 'hasPassword' | 'accounts'>): ProfileAccountSummary {
  const accountTypes: string[] = []
  if (user.hasPassword) accountTypes.push('Email')
  for (const { provider } of user.accounts) {
    accountTypes.push(PROVIDER_LABELS[provider] ?? provider)
  }

  const availableEmails = Array.from(
    new Set([user.email, ...user.accounts.map((account) => account.email).filter(Boolean) as string[]]),
  )

  return { accountTypes, availableEmails }
}

async function fetchProfileData(userId: string): Promise<ProfileData | null> {
  const [user, itemTypes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        password: true,
        editorPreferences: true,
        createdAt: true,
        accounts: { select: { id: true, provider: true, email: true } },
        _count: { select: { items: true, collections: true } },
      },
    }),
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
      editorPreferences: user.editorPreferences as unknown as EditorPreferences | null,
      accounts: user.accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email })),
      createdAt: user.createdAt,
    },
    stats: { totalItems: user._count.items, totalCollections: user._count.collections, itemTypeCounts },
  }
}

export async function getProfileData(userId: string): Promise<ProfileData | null> {
  return withDataCache(
    CacheTags.profile(userId),
    () => fetchProfileData(userId)
  )
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { email } })
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { name } })
}

export async function updateEditorPreferences(userId: string, preferences: EditorPreferences): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { editorPreferences: preferences as unknown as Prisma.InputJsonValue },
  })
}
