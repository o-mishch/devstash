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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import { WarningBanner } from '@/components/shared/warning-banner'

interface MainEmailSelectorProps {
  currentEmail: string
  availableEmails: string[]
  hasPassword: boolean
}

export function MainEmailSelector({ currentEmail, availableEmails, hasPassword }: MainEmailSelectorProps) {
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
      const { error } = await safe(orpcClient.profile.updateMainEmail({ email: target, password: currentPassword }))
      if (!error) {
        setEmail(target)
        toast.success(hasPassword ? 'Sign-in email updated.' : 'Display email updated.')
        router.refresh()
      } else {
        toast.error(error.message || 'Failed to update email.')
      }
    })
  }

  function confirmChange() {
    if (!pendingEmail) return
    const target = pendingEmail
    setPendingEmail(null)
    applyChange(target, password)
    setPassword('')
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
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{hasPassword ? 'Set sign-in email' : 'Set display email'}</p>
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
            <DialogTitle>Change sign-in email?</DialogTitle>
            <DialogDescription>
              Your credentials login email will change from{' '}
              <span className="font-medium text-foreground">{email}</span> to{' '}
              <span className="font-medium text-foreground">{pendingEmail}</span>.
            </DialogDescription>
          </DialogHeader>

          <WarningBanner>
            After confirming, use <strong>{pendingEmail}</strong> to sign in next time.
          </WarningBanner>

          <div className="space-y-2">
            <Label htmlFor="confirm-email-password">Current password</Label>
            <Input
              id="confirm-email-password"
              type="password"
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
