'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Unlink } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safe } from '@orpc/client'
import { orpcClient } from '@/lib/api/client'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { BaseProfileDialog } from './base-profile-dialog'

export function RemovePasswordDialog() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setPassword('')
  }

  function handleRemove() {
    startTransition(async () => {
      const { error } = await safe(orpcClient.profile.removeCredentials({ password }))
      if (!error) {
        toast.success('Password removed. Sign in via a linked account.')
        setOpen(false)
        setPassword('')
      } else {
        toast.error(error.message || 'Failed to remove password.')
      }
    })
  }

  return (
    <BaseProfileDialog
      title="Remove password"
      description="Your email & password sign-in will be removed. You can still sign in via your linked accounts."
      triggerText="Unlink"
      triggerIcon={<Unlink className="mr-1 size-3 max-sm:size-4" />}
      open={open}
      onOpenChange={handleOpenChange}
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-destructive max-sm:h-10 max-sm:w-full max-sm:justify-start max-sm:px-3 max-sm:text-sm"
    >
      <div className="space-y-2">
        <Label htmlFor="remove-password">Current password</Label>
        <Input
          id="remove-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>
      <DestructiveDialogFooter
        onCancel={() => handleOpenChange(false)}
        onConfirm={handleRemove}
        isPending={isPending}
        confirmText="Remove password"
      />
    </BaseProfileDialog>
  )
}
