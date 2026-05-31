import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, CalendarDays, Package, FolderOpen } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/shared/user-avatar'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { formatDate, PROVIDER_LABELS } from '@/lib/utils'
import { getCurrentUserId } from '@/lib/session'
import { getProfileData } from '@/lib/db/profile'

import { ConnectedAccounts } from './_components/connected-accounts'

export default async function ProfilePage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

  const data = await getProfileData(userId)
  if (!data) redirect('/sign-in')

  const { user, stats } = data

  const accountTypes: string[] = []
  if (user.hasPassword) accountTypes.push('Email Account')
  user.accounts.forEach(({ provider }) => {
    accountTypes.push(`${PROVIDER_LABELS[provider] ?? provider} Account`)
  })

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <Link
          href="/dashboard"
          className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your account and preferences</p>
        </div>
      </div>

      {/* Account Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar name={user.name} image={user.image} className="size-14" />
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name ?? 'No name set'}</p>
              <p className="text-xs text-muted-foreground">{accountTypes.join(' · ')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4 shrink-0" />
              <span>{user.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" />
              <span>Member since {formatDate(user.createdAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connected Accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Connected Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConnectedAccounts hasPassword={user.hasPassword} accounts={user.accounts} />
        </CardContent>
      </Card>

      {/* Usage Statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Usage Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Package className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold">{stats.totalItems}</p>
                <p className="text-xs text-muted-foreground">Total Items</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <FolderOpen className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold">{stats.totalCollections}</p>
                <p className="text-xs text-muted-foreground">Collections</p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              By Type
            </p>
            <div className="grid grid-cols-4 gap-2">
              {stats.itemTypeCounts.map((type) => (
                <div
                  key={type.name}
                  className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ItemTypeIcon iconName={type.icon} color={type.color} className="size-3 shrink-0" />
                    <span className="text-xs capitalize truncate">{type.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground ml-1.5 shrink-0">{type.count}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
