'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { Button, SubmitButton } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'
import { setInitialPasswordAction } from '@/actions/profile'

interface SetPasswordDialogProps {
  suggestedEmails: string[]
}

export function SetPasswordDialog({ suggestedEmails }: SetPasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const onSuccess = useCallback(() => {
    toast.success('Password set. You can now sign in with email & password.')
    setOpen(false)
    router.refresh()
  }, [router])

  const { formAction, isPending } = useActionStateWithToast(setInitialPasswordAction, { onSuccess })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <KeyRound className="mr-1 size-3" />
            Set password
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set a password</DialogTitle>
          <DialogDescription>
            Add email &amp; password sign-in to your account.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Sign-in email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="off"
              list="set-password-email-list"
              required
            />
            <datalist id="set-password-email-list">
              {suggestedEmails.map((e) => <option key={e} value={e} />)}
            </datalist>
          </div>
          <AuthFormField
            id="newPassword"
            name="newPassword"
            label="New password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
          <AuthFormField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />

          <SubmitButton className="w-full" isPending={isPending}>
            Set password
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  )
}
