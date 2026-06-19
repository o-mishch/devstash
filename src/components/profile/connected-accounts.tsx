'use client'

import { Mail, Unlink } from 'lucide-react'
import { ProviderIcon } from '@/components/shared/provider-icon'
import { PROVIDER_LABELS, SUPPORTED_OAUTH_PROVIDERS } from '@/lib/utils'
import { primaryEmailMovesWithCredential } from '@/lib/utils/auth'
import { linkWithProviderAction } from '@/actions/auth/login'
import { useProfileEmailsStore } from '@/stores/profile-emails'
import type { OAuthProvider } from '@/lib/utils/constants'
import type { LinkedAccount } from '@/types/profile'
import { ProfileActionDialog } from './profile-action-dialog'
import { ChangeCredentialEmailDialog } from './change-credential-email-dialog'
import { ChangePasswordForm } from './change-password-form'
import { SetPasswordDialog } from './set-password-dialog'
import { AddProviderSubmitButton } from './add-provider-submit-button'
import { RemovePasswordDialog } from './remove-password-dialog'

interface ConnectedAccountsProps {
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
    <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5 text-sm min-w-0">
        <Mail className="size-4 shrink-0 text-muted-foreground" />
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

interface ProviderAccountRowProps {
  account: LinkedAccount
  canUnlink: boolean
  onUnlinked: (id: string) => void
}

function ProviderAccountRow({ account, canUnlink, onUnlinked }: ProviderAccountRowProps) {
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
          triggerIcon={<Unlink className="mr-1 size-3 max-sm:size-4" />}
          triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-destructive max-sm:h-9 max-sm:px-2.5 max-sm:text-sm"
          confirmText={`Unlink ${label}`}
          accountId={account.id}
          successMessage={`${label} account unlinked.`}
          errorMessage="Failed to unlink account."
          onSuccess={() => onUnlinked(account.id)}
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

export function ConnectedAccounts({ verificationDisabled }: ConnectedAccountsProps) {
  // Credential-login presence + emails come from the shared profile-emails store so adding/deleting a
  // login reflects instantly here AND in the primary-email dropdown (a sibling in another card) — the
  // server re-render lags behind the route handler's stale-while-revalidate cache invalidation. The
  // displayed login email is the dedicated `credentialEmail` when set, else the primary `email`
  // (legacy owned-email password).
  const hasCredentialLogin = useProfileEmailsStore((state) => state.hasCredentialLogin)
  const credentialEmail = useProfileEmailsStore((state) => state.credentialEmail)
  const currentEmail = useProfileEmailsStore((state) => state.currentEmail)
  const availableEmails = useProfileEmailsStore((state) => state.availableEmails)
  const linkedAccounts = useProfileEmailsStore((state) => state.linkedAccounts)
  const addCredentialLogin = useProfileEmailsStore((state) => state.addCredentialLogin)
  const changeCredentialLogin = useProfileEmailsStore((state) => state.changeCredentialLogin)
  const removeCredentialLogin = useProfileEmailsStore((state) => state.removeCredentialLogin)
  const removeLinkedAccount = useProfileEmailsStore((state) => state.removeLinkedAccount)

  const loginEmail = credentialEmail ?? currentEmail
  const alsoMovesPrimaryEmail = primaryEmailMovesWithCredential({ email: currentEmail, credentialEmail })
  const totalMethods = (hasCredentialLogin ? 1 : 0) + linkedAccounts.length

  return (
    <div className="space-y-2">
      {hasCredentialLogin ? (
        <EmailRow
          email={loginEmail}
          alsoMovesPrimaryEmail={alsoMovesPrimaryEmail}
          canUnlink={linkedAccounts.length > 0}
          verificationDisabled={verificationDisabled}
          onChanged={changeCredentialLogin}
          onRemoved={removeCredentialLogin}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Mail className="size-4 shrink-0" />
            <span>Email &amp; Password</span>
          </div>
          <SetPasswordDialog
            suggestedEmails={availableEmails}
            verificationDisabled={verificationDisabled}
            onCredentialAdded={addCredentialLogin}
          />
        </div>
      )}
      {linkedAccounts.map((account) => (
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
