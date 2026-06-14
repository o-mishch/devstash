import { Mail, Unlink } from 'lucide-react'
import { ProviderIcon } from '@/components/shared/provider-icon'
import { PROVIDER_LABELS, SUPPORTED_OAUTH_PROVIDERS } from '@/lib/utils'
import { linkWithProviderAction } from '@/actions/auth/login'
import type { OAuthProvider } from '@/lib/utils/constants'
import type { LinkedAccount } from '@/lib/db/profile'
import { ProfileActionDialog } from './profile-action-dialog'
import { ChangeCredentialEmailDialog } from './change-credential-email-dialog'
import { ChangePasswordForm } from './change-password-form'
import { SetPasswordDialog } from './set-password-dialog'
import { AddProviderSubmitButton } from './add-provider-submit-button'
import { RemovePasswordDialog } from './remove-password-dialog'

interface ConnectedAccountsProps {
  hasPassword: boolean
  accounts: LinkedAccount[]
  currentEmail: string
  availableEmails: string[]
}

interface EmailRowProps {
  email: string
  canUnlink: boolean
}

function EmailRow({ email, canUnlink }: EmailRowProps) {
  const removePasswordDialog = canUnlink ? <RemovePasswordDialog /> : null

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between w-full sm:w-auto gap-3 min-w-0">
        <div className="flex items-center gap-2.5 text-sm min-w-0">
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <span>Email &amp; Password</span>
            <p className="text-xs text-muted-foreground truncate">{email}</p>
          </div>
        </div>
        {canUnlink && (
          <div className="sm:hidden shrink-0">
            {removePasswordDialog}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
        <ChangeCredentialEmailDialog currentEmail={email} />
        <ChangePasswordForm />
        {canUnlink && (
          <div className="hidden sm:block">
            {removePasswordDialog}
          </div>
        )}
      </div>
    </div>
  )
}

interface ProviderAccountRowProps {
  account: LinkedAccount
  canUnlink: boolean
}

function ProviderAccountRow({ account, canUnlink }: ProviderAccountRowProps) {
  const label = PROVIDER_LABELS[account.provider] ?? account.provider

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm min-w-0">
        <span className="text-muted-foreground shrink-0"><ProviderIcon provider={account.provider} className="size-4" /></span>
        <div className="min-w-0">
          <span>{label}</span>
          {account.email && (
            <p className="text-xs text-muted-foreground truncate">{account.email}</p>
          )}
        </div>
      </div>
      {canUnlink ? (
        <ProfileActionDialog
          title={`Unlink ${label}`}
          description={`Your ${label} account will be disconnected. You can still sign in with your other linked methods.`}
          triggerText="Unlink"
          triggerIcon={<Unlink className="mr-1 size-3" />}
          confirmText={`Unlink ${label}`}
          endpoint={`/api/profile/accounts/${account.id}`}
          successMessage={`${label} account unlinked.`}
          errorMessage="Failed to unlink account."
        />
      ) : (
        <span className="text-xs text-muted-foreground shrink-0">Connected</span>
      )}
    </div>
  )
}

interface AddProviderRowProps {
  provider: OAuthProvider
}

function AddProviderRow({ provider }: AddProviderRowProps) {
  const label = PROVIDER_LABELS[provider] ?? provider

  const action = linkWithProviderAction.bind(null, provider)

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <ProviderIcon provider={provider} className="size-4 shrink-0" />
        <span>Add {label}</span>
      </div>
      <form action={action}>
        <AddProviderSubmitButton />
      </form>
    </div>
  )
}

export function ConnectedAccounts({ hasPassword, accounts, currentEmail, availableEmails }: ConnectedAccountsProps) {
  const totalMethods = (hasPassword ? 1 : 0) + accounts.length

  return (
    <div className="space-y-2">
      {hasPassword ? (
        <EmailRow email={currentEmail} canUnlink={accounts.length > 0} />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Mail className="size-4 shrink-0" />
            <span>Email &amp; Password</span>
          </div>
          <SetPasswordDialog suggestedEmails={availableEmails} />
        </div>
      )}
      {accounts.map((account) => (
        <ProviderAccountRow
          key={account.id}
          account={account}
          canUnlink={totalMethods > 1}
        />
      ))}
      {SUPPORTED_OAUTH_PROVIDERS
        .map((provider) => (
          <AddProviderRow key={provider} provider={provider} />
        ))}
    </div>
  )
}
