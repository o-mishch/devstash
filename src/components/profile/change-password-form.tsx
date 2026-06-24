'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { Button, SubmitButton } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { useApiFormAction } from '@/hooks/ui/use-api-form-action'

export function ChangePasswordForm() {
  const [open, setOpen] = useState(false)
  const { formAction, isPending } = useApiFormAction(async (body) => {
    const { error } = await api.PATCH('/profile/password', {
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        confirmPassword: body.confirmPassword,
      },
    })
    if (error) throw new Error(error.message)
  }, {
    onSuccess: () => {
      toast.success('Password updated successfully.')
      setOpen(false)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground max-sm:h-10 max-sm:w-full max-sm:justify-start max-sm:px-3 max-sm:text-sm"><KeyRound className="mr-1 size-3 max-sm:size-4" />Change password</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput
              id="currentPassword"
              name="currentPassword"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton isPending={isPending}>
              Update Password
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
