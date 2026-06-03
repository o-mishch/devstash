'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { removeCredentialsAction } from '@/actions/profile'

export function RemoveCredentialsDialog() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRemove() {
    startTransition(async () => {
      const result = await removeCredentialsAction()
      if (result.status === 'ok') {
        toast.success('Password removed. Sign in via a linked account.')
        setOpen(false)
      } else {
        toast.error(result.message ?? 'Failed to remove password.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive">
            <Unlink className="mr-1 size-3" />
            Unlink
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove password</DialogTitle>
          <DialogDescription>
            Your email &amp; password sign-in will be removed. You can still sign in via your
            linked accounts.
          </DialogDescription>
        </DialogHeader>
        <DestructiveDialogFooter
          onCancel={() => setOpen(false)}
          onConfirm={handleRemove}
          isPending={isPending}
          confirmText="Remove password"
        />
      </DialogContent>
    </Dialog>
  )
}
