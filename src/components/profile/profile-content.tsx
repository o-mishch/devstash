'use client'

import Link from 'next/link'
import { ArrowLeft, Package, FolderOpen, UserRound, KeyRound, BarChart3 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { CollapsibleCard } from '@/components/shared/collapsible-card'
import { UserAvatar } from '@/components/shared/user-avatar'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { DeleteAccountDialog } from '@/components/profile/delete-account-dialog'
import { ConnectedAccounts } from '@/components/profile/connected-accounts'
import { ProfileToast, type ToastCode } from '@/components/profile/profile-toast'
import { ProfileEmailSection } from '@/components/profile/profile-email-section'
import { EditableName } from '@/components/profile/editable-name'
import { useProfile } from '@/hooks/use-profile'
import type { ProfileContextResponse } from '@/lib/api/schemas/profile'
import ProfileLoading from '@/app/(app)/profile/loading'

interface ProfileContentProps {
  initialData: ProfileContextResponse
  toast?: ToastCode
}

export function ProfileContent({ initialData, toast }: ProfileContentProps) {
  const { data: profile } = useProfile({ initialData })

  if (!profile) return <ProfileLoading />

  const { name, email, image, hasPassword, credentialEmail, isPro, createdAt, accounts,
    accountTypes, availableEmails, verificationDisabled, stats } = profile

  return (
    <div className="app-page gap-5 p-6">
      <div className="flex items-start gap-3">
        <Link href="/dashboard" prefetch={false} className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Profile</h1>
          <p className="text-sm text-muted-foreground">Account security and usage</p>
        </div>
      </div>

      {toast && <ProfileToast code={toast} />}

      <CollapsibleCard title="Account Information" icon={<UserRound />}>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar name={name} image={image} className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <EditableName name={name} />
              <p className="text-xs text-muted-foreground">{accountTypes.join(' · ')}</p>
            </div>
          </div>

          <ProfileEmailSection
            currentEmail={email}
            availableEmails={availableEmails}
            hasPassword={hasPassword}
            createdAt={new Date(createdAt)}
            isPro={isPro}
          />
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Sign-in Methods" icon={<KeyRound />}>
        <ConnectedAccounts
          currentEmail={email}
          availableEmails={availableEmails}
          hasPassword={hasPassword}
          credentialEmail={credentialEmail}
          accounts={accounts}
          verificationDisabled={verificationDisabled}
        />
      </CollapsibleCard>

      <CollapsibleCard title="Usage" icon={<BarChart3 />}>
        <div className="space-y-4">
          <div className="app-grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="card-tier-2 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
              <Package className="card-icon size-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold">{stats.totalItems}</p>
                <p className="text-xs text-muted-foreground">Items</p>
              </div>
            </div>
            <div className="card-tier-2 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
              <FolderOpen className="card-icon size-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold">{stats.totalCollections}</p>
                <p className="text-xs text-muted-foreground">Collections</p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="app-grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.itemTypeCounts.map((type) => (
              <div
                key={type.name}
                className="card-tier-2 group flex items-center justify-between rounded-lg border px-2.5 py-2 transition-colors"
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
      </CollapsibleCard>

      <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Delete Account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently removes your account and all data. This cannot be undone.
            </p>
          </div>
          <DeleteAccountDialog hasPassword={hasPassword} />
        </div>
      </div>
    </div>
  )
}
