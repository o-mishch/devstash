'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { changePasswordAction } from '@/actions/profile'
import type { ApiBody } from '@/types/api'

export function ChangePasswordForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ApiBody<null> | null, FormData>(
    changePasswordAction,
    null
  )

  useEffect(() => {
    if (!state) return
    if (state.status === 'ok') {
      toast.success('Password updated successfully.')
      setOpen(false)
    } else {
      toast.error(state.message ?? 'Something went wrong. Please try again.')
    }
  }, [state])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm"><KeyRound className="size-4" />Change Password</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
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
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
              Update Password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
