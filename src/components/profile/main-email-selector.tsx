'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { usePatchUserProfile } from '@/hooks/profile/use-user-profile'
import { usePatchProfile } from '@/hooks/profile/use-profile'

interface MainEmailSelectorProps {
  currentEmail: string
  availableEmails: string[]
  hasPassword: boolean
  isPro: boolean
}

interface ChangeEmailVariables {
  target: string
  currentPassword?: string
}

export function MainEmailSelector({ currentEmail, availableEmails, hasPassword, isPro }: MainEmailSelectorProps) {
  const patchUserProfile = usePatchUserProfile()
  const patchProfile = usePatchProfile()
  // `currentEmail` is the live value from the /profile cache (via ProfileContent), so it reflects each
  // optimistic patch — no separate local/store copy needed.
  const currentDisplayEmail = currentEmail

  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  const changeMutation = useMutation({
    mutationFn: async ({ target, currentPassword }: ChangeEmailVariables) => {
      const { error } = await api.PATCH('/profile/main-email', { body: { email: target, password: currentPassword } })
      if (error) throw new Error(error.message || 'Failed to update email.')
      return target
    },
    onSuccess: (target) => {
      // Patch both caches: /profile/me backs the sidebar; /profile backs this page's email controls.
      patchUserProfile({ email: target })
      patchProfile({ email: target })
      // Close the confirm dialog only on success — on failure it stays open so the user can retry
      // without re-selecting the target email from the dropdown.
      setPendingEmail(null)
      setPassword('')
      toast.success(hasPassword ? 'Primary email updated.' : 'Display email updated.')
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to update email.'),
  })
  const isPending = changeMutation.isPending

  function requestChange(newEmail: string) {
    if (newEmail === currentDisplayEmail) return
    if (hasPassword) {
      setPassword('')
      setPendingEmail(newEmail)
    } else {
      applyChange(newEmail)
    }
  }

  function applyChange(target: string, currentPassword?: string) {
    changeMutation.mutate({ target, currentPassword })
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
          <span className="truncate">{currentDisplayEmail}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="!w-auto min-w-48">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{hasPassword ? 'Set primary email' : 'Set display email'}</p>
          <DropdownMenuSeparator />
          {availableEmails.map((e) => (
            <DropdownMenuItem key={e} onClick={() => requestChange(e)} className="gap-2">
              <Check className={`size-3 shrink-0 transition-opacity ${e === currentDisplayEmail ? 'opacity-100' : 'opacity-0'}`} />
              <span className="truncate">{e}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pendingEmail !== null} onOpenChange={(open) => { if (!open) { setPendingEmail(null); setPassword('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change primary email?</DialogTitle>
            <DialogDescription>
              Confirm your password to update your primary email.
            </DialogDescription>
          </DialogHeader>

          <WarningBanner>
            <div className="space-y-1.5">
              <p>
                You are switching your primary email. All email notifications will be sent to the new primary email (changing from <span className="font-medium text-foreground">{currentDisplayEmail}</span> to <span className="font-medium text-foreground">{pendingEmail}</span>).
              </p>
              {isPro && (
                <p>
                  The email of your subscription will be updated in the payment provider.
                </p>
              )}
            </div>
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
