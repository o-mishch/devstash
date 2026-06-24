import 'server-only'

import { cacheTag, cacheLife } from 'next/cache'
import { prisma } from '@/lib/infra/prisma'
import { CacheTags } from '@/lib/infra/cache'
import { logger } from '@/lib/infra/pino'
import { compareBySystemTypeOrder, PROVIDER_LABELS } from '@/lib/utils/constants'
import type { EditorPreferences } from '@/types/editor-preferences'
import type { LinkedAccount } from '@/types/profile'
import type { Prisma } from '@/generated/prisma/client'

export type { LinkedAccount } from '@/types/profile'

const log = logger.child({ tag: 'db:profile' })

interface ProfileUser {
  id: string
  name: string | null
  email: string
  credentialEmail: string | null
  credentialEmailVerified: Date | null
  image: string | null
  hasPassword: boolean
  editorPreferences: EditorPreferences | null
  accounts: LinkedAccount[]
  createdAt: Date
  isPro: boolean
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

interface OwnedEmailSources {
  email: string
  credentialEmail: string | null
  credentialEmailVerified: Date | null
  accounts: { email: string | null }[]
}

/** Deduped owned addresses: primary, verified credential login, and linked OAuth emails. */
export function buildOwnedEmails(user: OwnedEmailSources): string[] {
  const credentialEmail =
    user.credentialEmail && user.credentialEmailVerified ? [user.credentialEmail] : []
  return Array.from(
    new Set([
      user.email,
      ...credentialEmail,
      ...user.accounts.map((account) => account.email).filter(Boolean) as string[],
    ]),
  )
}

/** Derives sign-in method labels and deduped owned emails for profile UI. */
export function getProfileAccountSummary(
  user: Pick<ProfileUser, 'email' | 'credentialEmail' | 'credentialEmailVerified' | 'hasPassword' | 'accounts'>,
): ProfileAccountSummary {
  const accountTypes = Array.from(
    new Set([
      ...(user.hasPassword ? ['Email'] : []),
      ...user.accounts.map(({ provider }) => PROVIDER_LABELS[provider] ?? provider),
    ])
  )

  return { accountTypes, availableEmails: buildOwnedEmails(user) }
}

export async function getEditorPreferences(userId: string): Promise<EditorPreferences | null> {
  'use cache'
  const cacheKey = CacheTags.profile(userId)
  cacheTag(cacheKey)
  cacheLife('max')
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { editorPreferences: true },
  })
  return user?.editorPreferences as unknown as EditorPreferences | null
}

export async function getProfileData(userId: string): Promise<ProfileData | null> {
  'use cache'
  const cacheKey = CacheTags.profile(userId)
  // Item and collection counts are embedded in this query — invalidate when either group changes.
  cacheTag(cacheKey, CacheTags.itemGroup(userId), CacheTags.collectionGroup(userId))
  cacheLife('max')
  const start = Date.now()
  const [user, itemTypes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        credentialEmail: true,
        credentialEmailVerified: true,
        image: true,
        password: true,
        editorPreferences: true,
        createdAt: true,
        accounts: { select: { id: true, provider: true, email: true } },
        _count: { select: { items: true, collections: true } },
        isPro: true,
      },
    }),
    prisma.itemType.findMany({
      where: { isSystem: true, userId: null },
      include: { _count: { select: { items: { where: { userId } } } } },
    }),
  ])
  const duration = Date.now() - start

  if (!user) {
    log.info({ userId, cacheKey, found: false, duration }, 'DB: getProfileData - user not found')
    return null
  }

  const itemTypeCounts: ItemTypeCount[] = itemTypes
    .map((t) => ({
      name: t.name,
      icon: t.icon,
      color: t.color,
      count: t._count.items,
    }))
    .sort(compareBySystemTypeOrder)

  const result = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      credentialEmail: user.credentialEmail,
      credentialEmailVerified: user.credentialEmailVerified,
      image: user.image,
      hasPassword: !!user.password,
      editorPreferences: user.editorPreferences as unknown as EditorPreferences | null,
      accounts: user.accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email })),
      createdAt: user.createdAt,
      isPro: user.isPro,
    },

    stats: { totalItems: user._count.items, totalCollections: user._count.collections, itemTypeCounts },
  }

  log.info({ userId, cacheKey, found: true, itemCount: user._count.items, collectionCount: user._count.collections, duration }, 'DB: getProfileData - success')
  return result
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  const start = Date.now()
  await prisma.user.update({ where: { id: userId }, data: { email } })
  log.info({ userId, duration: Date.now() - start }, 'DB: updateUserEmail')
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  const start = Date.now()
  await prisma.user.update({ where: { id: userId }, data: { name } })
  log.info({ userId, duration: Date.now() - start }, 'DB: updateUserName')
}

export async function updateEditorPreferences(userId: string, preferences: EditorPreferences): Promise<void> {
  const start = Date.now()
  await prisma.user.update({
    where: { id: userId },
    data: { editorPreferences: preferences as unknown as Prisma.InputJsonValue },
  })
  log.info({ userId, duration: Date.now() - start }, 'DB: updateEditorPreferences')
}
