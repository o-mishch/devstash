import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Package, FolderOpen } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { UserAvatar } from '@/components/shared/user-avatar'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { getCurrentUserId } from '@/lib/session'
import { getProfileData, getProfileAccountSummary } from '@/lib/db/profile'
import { outboundEmailEnabled } from '@/lib/utils/auth'
import { DeleteAccountDialog } from '@/components/profile/delete-account-dialog'
import { ConnectedAccounts } from '@/components/profile/connected-accounts'
import { ProfileToast, type ToastCode } from '@/components/profile/profile-toast'
import { ProfileEmailSection } from '@/components/profile/profile-email-section'
import { EditableName } from '@/components/profile/editable-name'

interface ProfilePageProps {
  searchParams: Promise<{ toast?: string }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const flash = ((await searchParams).toast) as ToastCode | undefined
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

  const data = await getProfileData(userId)
  if (!data) redirect('/sign-in')

  const { user, stats } = data
  const { accountTypes, availableEmails } = getProfileAccountSummary(user)

  // When email verification is disabled, adding an Email & Password login for an unowned address skips
  // the confirmation link and activates instantly — the dialog collects the password up front.
  const verificationDisabled = !outboundEmailEnabled()

  return (
    <div className="app-page gap-5 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/dashboard" prefetch={false} className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Profile</h1>
          <p className="text-sm text-muted-foreground">Account security and usage</p>
        </div>
      </div>

      {flash && <ProfileToast code={flash} />}

      {/* Account Information */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar name={user.name} image={user.image} className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <EditableName name={user.name} />
              <p className="text-xs text-muted-foreground">{accountTypes.join(' · ')}</p>
            </div>
          </div>

          <ProfileEmailSection
            initialState={{
              currentEmail: user.email,
              availableEmails,
              hasCredentialLogin: user.hasPassword,
              credentialEmail: user.credentialEmail,
              linkedAccounts: user.accounts,
            }}
            createdAt={user.createdAt}
          />
        </CardContent>
      </Card>

      {/* Sign-in Methods */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Sign-in Methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConnectedAccounts
            accounts={user.accounts}
            verificationDisabled={verificationDisabled}
          />
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="app-grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Package className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold">{stats.totalItems}</p>
                <p className="text-xs text-muted-foreground">Items</p>
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

          <div className="app-grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        </CardContent>
      </Card>

      {/* Danger zone — no card chrome, stands apart */}
      <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Delete Account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently removes your account and all data. This cannot be undone.
            </p>
          </div>
          <DeleteAccountDialog hasPassword={user.hasPassword} />
        </div>
      </div>
    </div>
  )
}
