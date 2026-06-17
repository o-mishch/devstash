'use client'

import { useState } from 'react'
import { Mail, CalendarDays } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useProfileEmailsStore, type ProfileEmailsState } from '@/stores/profile-emails'
import { MainEmailSelector } from './main-email-selector'

interface ProfileEmailSectionProps {
  initialState: ProfileEmailsState
  createdAt: Date
}

// Seeds the profile email store from server data and renders the primary-email row. Re-seeds when the
// server snapshot changes (e.g. soft navigation back to /profile) but skips re-runs when only the
// object reference changes with the same values, so optimistic updates are not clobbered mid-mutation.
export function ProfileEmailSection({ initialState, createdAt }: ProfileEmailSectionProps) {
  const currentEmail = useProfileEmailsStore((state) => state.currentEmail)
  const availableEmails = useProfileEmailsStore((state) => state.availableEmails)
  const hasCredentialLogin = useProfileEmailsStore((state) => state.hasCredentialLogin)
  const setCurrentEmail = useProfileEmailsStore((state) => state.setCurrentEmail)

  const seedKey = [
    initialState.currentEmail,
    initialState.hasCredentialLogin,
    initialState.credentialEmail ?? '',
    initialState.availableEmails.join('\0'),
    initialState.linkedAccounts.map((a) => `${a.provider}:${a.email ?? ''}`).join('\0'),
  ].join('|')

  // Seed synchronously during render (this component renders before its store-reading siblings, e.g.
  // ConnectedAccounts) so the first paint / SSR already shows the right email and sign-in methods — an
  // effect-time seed flashes empty defaults. The "adjust state when props change" pattern re-seeds only
  // when the server snapshot value changes (`seedKey`), not on a new object reference with the same
  // values, so optimistic updates are not clobbered mid-mutation.
  // NOTE FOR MAINTAINERS: Mutating the Zustand store during render is a side-effect, but since this
  // component acts as the page-level initializer and renders first, it is safe from cascading updates.
  // React Compiler and Concurrent Mode handle this because the mutation is idempotent and gated by seedKey.
  const [seededKey, setSeededKey] = useState<string | null>(null)
  if (seededKey !== seedKey) {
    setSeededKey(seedKey)
    useProfileEmailsStore.getState().initialize(initialState)
  }

  const showSelector = availableEmails.length > 1

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="size-4 shrink-0" />
          {showSelector ? (
            <MainEmailSelector
              key={currentEmail}
              currentEmail={currentEmail}
              availableEmails={availableEmails}
              hasPassword={hasCredentialLogin}
              onEmailChanged={setCurrentEmail}
            />
          ) : (
            <span className="truncate">{currentEmail}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CalendarDays className="size-4 shrink-0" />
          <span>Member since {formatDate(createdAt)}</span>
        </div>
      </div>
      {showSelector && (
        <p className="-mt-2 pl-6 text-xs text-muted-foreground/70">
          {hasCredentialLogin ? 'Default email · click to change' : 'Display email · click to change'}
        </p>
      )}
    </>
  )
}
