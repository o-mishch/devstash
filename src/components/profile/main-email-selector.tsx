'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button, SubmitButton } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api/client'
import { WarningBanner } from '@/components/shared/warning-banner'

interface MainEmailSelectorProps {
  currentEmail: string
  availableEmails: string[]
  hasPassword: boolean
  // Notifies the parent (shared profile-emails store) on a successful change so siblings stay in sync.
  onEmailChanged?: (email: string) => void
}

export function MainEmailSelector({ currentEmail, availableEmails, hasPassword, onEmailChanged }: MainEmailSelectorProps) {
  const [email, setEmail] = useState(currentEmail)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function requestChange(newEmail: string) {
    if (newEmail === email) return
    if (hasPassword) {
      setPassword('')
      setPendingEmail(newEmail)
    } else {
      applyChange(newEmail)
    }
  }

  function applyChange(target: string, currentPassword?: string) {
    startTransition(async () => {
      const { error } = await api.PATCH('/profile/main-email', { body: { email: target, password: currentPassword } })
      if (!error) {
        setEmail(target)
        onEmailChanged?.(target)
        // Close the confirm dialog only on success — on failure it stays open so the user can retry
        // without re-selecting the target email from the dropdown.
        setPendingEmail(null)
        setPassword('')
        toast.success(hasPassword ? 'Default email updated.' : 'Display email updated.')
        router.refresh()
      } else {
        toast.error(error.message || 'Failed to update email.')
      }
    })
  }

  function confirmChange() {
    if (!pendingEmail) return
    applyChange(pendingEmail, password)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isPending}
          className="group flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <span className="truncate">{email}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="!w-auto min-w-48">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{hasPassword ? 'Set default email' : 'Set display email'}</p>
          <DropdownMenuSeparator />
          {availableEmails.map((e) => (
            <DropdownMenuItem key={e} onClick={() => requestChange(e)} className="gap-2">
              <Check className={`size-3 shrink-0 transition-opacity ${e === email ? 'opacity-100' : 'opacity-0'}`} />
              <span className="truncate">{e}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pendingEmail !== null} onOpenChange={(open) => { if (!open) { setPendingEmail(null); setPassword('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change default email?</DialogTitle>
            <DialogDescription>
              Your account&apos;s default email will change from{' '}
              <span className="font-medium text-foreground">{email}</span> to{' '}
              <span className="font-medium text-foreground">{pendingEmail}</span>.
            </DialogDescription>
          </DialogHeader>

          <WarningBanner>
            This only changes your account&apos;s default email. Your email &amp; password sign-in stays the
            same — to change the address you sign in with, use <strong>Change email</strong> on your
            Email &amp; Password method.
          </WarningBanner>

          <div className="space-y-2">
            <Label htmlFor="confirm-email-password">Current password</Label>
            <PasswordInput
              id="confirm-email-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setPendingEmail(null); setPassword('') }} disabled={isPending}>
              Cancel
            </Button>
            <SubmitButton isPending={isPending} onClick={confirmChange} disabled={!password.trim()}>
              Confirm change
            </SubmitButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
