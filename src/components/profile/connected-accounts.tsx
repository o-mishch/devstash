'use client'

import { useCallback, useMemo } from 'react'
import { Mail, Unlink } from 'lucide-react'
import { ProviderIcon } from '@/components/shared/provider-icon'
import { PROVIDER_LABELS, SUPPORTED_OAUTH_PROVIDERS } from '@/lib/utils'
import { primaryEmailMovesWithCredential } from '@/lib/utils/auth'
import { linkWithProviderAction } from '@/actions/auth/login'
import {
  useAddCredentialLogin,
  useChangeCredentialLogin,
  useRemoveCredentialLogin,
  useRemoveLinkedAccount,
} from '@/hooks/profile/use-profile'
import type { OAuthProvider } from '@/lib/utils/constants'
import type { LinkedAccount } from '@/types/profile'
import { ProfileActionDialog } from './profile-action-dialog'
import { ChangeCredentialEmailDialog } from './change-credential-email-dialog'
import { ChangePasswordForm } from './change-password-form'
import { SetPasswordDialog } from './set-password-dialog'
import { AddProviderSubmitButton } from './add-provider-submit-button'
import { RemovePasswordDialog } from './remove-password-dialog'

interface ConnectedAccountsProps {
  currentEmail: string
  availableEmails: string[]
  hasPassword: boolean
  credentialEmail: string | null
  accounts: LinkedAccount[]
  verificationDisabled: boolean
}

interface EmailRowProps {
  email: string
  alsoMovesPrimaryEmail: boolean
  canUnlink: boolean
  verificationDisabled: boolean
  onChanged: (email: string) => void
  onRemoved: () => void
}

function EmailRow({ email, alsoMovesPrimaryEmail, canUnlink, verificationDisabled, onChanged, onRemoved }: EmailRowProps) {
  return (
    <div className="card-surface card-hover group flex flex-col gap-3 rounded-lg border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5 text-sm min-w-0">
        <Mail className="card-icon size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <span>Email &amp; Password</span>
          <p className="text-xs text-muted-foreground truncate">{email}</p>
        </div>
      </div>
      {/* Mobile: full-width stacked buttons under a divider; desktop: compact row on the right. */}
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-1 sm:border-t-0 sm:pt-0 sm:shrink-0">
        <ChangeCredentialEmailDialog
          currentEmail={email}
          alsoMovesPrimaryEmail={alsoMovesPrimaryEmail}
          verificationDisabled={verificationDisabled}
          onCredentialChanged={onChanged}
        />
        <ChangePasswordForm />
        {canUnlink && <RemovePasswordDialog onCredentialRemoved={onRemoved} />}
      </div>
    </div>
  )
}

// Fully static — no prop/state dependency — so it's hoisted once at module scope
// instead of re-created (and re-memoized) on every render of every row.
const UNLINK_TRIGGER_ICON = <Unlink className="mr-1 size-3 max-sm:size-4" />

interface ProviderAccountRowProps {
  account: LinkedAccount
  canUnlink: boolean
  onUnlinked: (id: string) => void
}

function ProviderAccountRow({ account, canUnlink, onUnlinked }: ProviderAccountRowProps) {
  const label = PROVIDER_LABELS[account.provider] ?? account.provider
  const accountId = account.id
  const handleUnlinked = useCallback(() => {
    onUnlinked(accountId)
  }, [onUnlinked, accountId])

  return (
    <div className="card-surface card-hover group flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm min-w-0">
        <span className="text-muted-foreground shrink-0"><ProviderIcon provider={account.provider} className="card-icon size-4" /></span>
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
          triggerIcon={UNLINK_TRIGGER_ICON}
          triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-destructive max-sm:h-9 max-sm:px-2.5 max-sm:text-sm"
          confirmText={`Unlink ${label}`}
          accountId={account.id}
          successMessage={`${label} account unlinked.`}
          errorMessage="Failed to unlink account."
          onSuccess={handleUnlinked}
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

  const action = useMemo(() => linkWithProviderAction.bind(null, provider), [provider])

  return (
    <div className="card-hover group flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <ProviderIcon provider={provider} className="card-icon size-4 shrink-0" />
        <span>Add {label}</span>
      </div>
      <form action={action}>
        <AddProviderSubmitButton />
      </form>
    </div>
  )
}

export function ConnectedAccounts({
  currentEmail,
  availableEmails,
  hasPassword,
  credentialEmail,
  accounts,
  verificationDisabled,
}: ConnectedAccountsProps) {
  // All values come from the `/profile` query cache (via ProfileContent); the mutation hooks below patch
  // that cache optimistically, so adding/changing/removing a login reflects instantly here AND in the
  // primary-email dropdown (a sibling card reading the same cache). The displayed login email is the
  // dedicated `credentialEmail` when set, else the primary `email` (legacy owned-email password).
  const addCredentialLogin = useAddCredentialLogin()
  const changeCredentialLogin = useChangeCredentialLogin()
  const removeCredentialLogin = useRemoveCredentialLogin()
  const removeLinkedAccount = useRemoveLinkedAccount()

  const loginEmail = credentialEmail ?? currentEmail
  const alsoMovesPrimaryEmail = primaryEmailMovesWithCredential({ email: currentEmail, credentialEmail })
  const totalMethods = (hasPassword ? 1 : 0) + accounts.length

  return (
    <div className="space-y-2">
      {hasPassword ? (
        <EmailRow
          email={loginEmail}
          alsoMovesPrimaryEmail={alsoMovesPrimaryEmail}
          canUnlink={accounts.length > 0}
          verificationDisabled={verificationDisabled}
          onChanged={changeCredentialLogin}
          onRemoved={removeCredentialLogin}
        />
      ) : (
        <div className="card-hover group flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Mail className="card-icon size-4 shrink-0" />
            <span>Email &amp; Password</span>
          </div>
          <SetPasswordDialog
            suggestedEmails={availableEmails}
            verificationDisabled={verificationDisabled}
            onCredentialAdded={addCredentialLogin}
          />
        </div>
      )}
      {accounts.map((account) => (
        <ProviderAccountRow
          key={account.id}
          account={account}
          canUnlink={totalMethods > 1}
          onUnlinked={removeLinkedAccount}
        />
      ))}
      {SUPPORTED_OAUTH_PROVIDERS.map((provider) => (
        <AddProviderRow key={provider} provider={provider} />
      ))}
    </div>
  )
}
