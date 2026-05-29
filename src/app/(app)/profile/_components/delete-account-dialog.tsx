'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { deleteAccountAction } from '@/actions/profile'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'

export function DeleteAccountDialog() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteAccountAction()
      } catch {
        toast.error('Failed to delete account. Please try again.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        <DestructiveDialogFooter
          onCancel={() => setOpen(false)}
          onConfirm={handleDelete}
          isPending={isPending}
          confirmText="Yes, Delete My Account"
        />
      </DialogContent>
    </Dialog>
  )
}
