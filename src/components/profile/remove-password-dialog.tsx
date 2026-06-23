'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api/client'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { BaseProfileDialog } from './base-profile-dialog'

interface RemovePasswordDialogProps {
  // Called on success so the parent can hide the row immediately — the server re-render lags behind
  // the route handler's stale-while-revalidate cache invalidation.
  onCredentialRemoved: () => void
}

export function RemovePasswordDialog({ onCredentialRemoved }: RemovePasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const router = useRouter()

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setPassword('')
  }

  const removeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/profile/credentials', { body: { password } })
      if (error) throw new Error(error.message || 'Failed to delete sign-in.')
    },
    onSuccess: () => {
      toast.success('Email & Password sign-in deleted. Sign in via a linked account.')
      setOpen(false)
      setPassword('')
      onCredentialRemoved()
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete sign-in.'),
  })

  return (
    <BaseProfileDialog
      title="Delete Email & Password sign-in"
      description="This permanently removes your password and your separate login email. You'll no longer be able to sign in with email & password — only your linked accounts. Your items and collections are not affected."
      triggerText="Delete"
      triggerIcon={<Trash2 className="mr-1 size-3 text-destructive max-sm:size-4" />}
      open={open}
      onOpenChange={handleOpenChange}
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-destructive max-sm:h-10 max-sm:w-full max-sm:justify-start max-sm:px-3 max-sm:text-sm"
    >
      <div className="space-y-2">
        <Label htmlFor="remove-password">Current password</Label>
        <PasswordInput
          id="remove-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>
      <DestructiveDialogFooter
        onCancel={() => handleOpenChange(false)}
        onConfirm={() => removeMutation.mutate()}
        isPending={removeMutation.isPending}
        confirmText="Delete"
      />
    </BaseProfileDialog>
  )
}
