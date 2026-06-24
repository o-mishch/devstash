'use client'

import { Mail, CalendarDays } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { MainEmailSelector } from './main-email-selector'

interface ProfileEmailSectionProps {
  currentEmail: string
  availableEmails: string[]
  hasPassword: boolean
  createdAt: Date
  isPro: boolean
}

// Renders the primary-email row. All values come from the `/profile` query cache (via ProfileContent),
// so optimistic patches from the email/credential dialogs flow straight through — no separate store.
export function ProfileEmailSection({ currentEmail, availableEmails, hasPassword, createdAt, isPro }: ProfileEmailSectionProps) {
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
              hasPassword={hasPassword}
              isPro={isPro}
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
          {hasPassword ? 'Primary email · click to change' : 'Display email · click to change'}
        </p>
      )}
    </>
  )
}
