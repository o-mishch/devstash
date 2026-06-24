'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { useResetProfile } from '@/hooks/use-profile'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'

interface DeleteAccountDialogProps {
  hasPassword?: boolean
}

export function DeleteAccountDialog({ hasPassword = false }: DeleteAccountDialogProps) {
  const router = useRouter()
  const resetProfile = useResetProfile()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/profile', { body: { password: hasPassword ? password : undefined } })
      if (error) throw new Error(error.message || 'Failed to delete account. Please try again.')
    },
    onSuccess: () => {
      // Drop the /profile cache so the deleted account's emails (PII) don't linger for the next sign-in
      // on this device.
      resetProfile()
      router.push('/')
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete account. Please try again.'),
  })
  const isPending = deleteMutation.isPending

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setPassword('')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm">
            <Trash2 className="mr-1.5 size-4" />
            Delete Account
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Account</DialogTitle>
          <DialogDescription>
            This action is permanent. All your items, collections, and data will be deleted and
            cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        {hasPassword && (
          <div className="space-y-2">
            <Label htmlFor="delete-account-password">Current password</Label>
            <PasswordInput
              id="delete-account-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
          </div>
        )}
        <DestructiveDialogFooter
          onCancel={() => handleOpenChange(false)}
          onConfirm={() => deleteMutation.mutate()}
          isPending={isPending}
          confirmDisabled={hasPassword && !password.trim()}
          confirmText="Yes, Delete My Account"
        />
      </DialogContent>
    </Dialog>
  )
}
