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
import { unlinkProviderAction } from '@/actions/profile'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'

interface UnlinkProviderDialogProps {
  accountId: string
  label: string
}

export function UnlinkProviderDialog({ accountId, label }: UnlinkProviderDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkProviderAction(accountId)
      if (result.status === 'ok') {
        toast.success(`${label} account unlinked.`)
        setOpen(false)
      } else {
        toast.error(result.message ?? 'Failed to unlink account.')
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
          <DialogTitle>Unlink {label}</DialogTitle>
          <DialogDescription>
            Your {label} account will be disconnected. You can still sign in with your other
            linked methods.
          </DialogDescription>
        </DialogHeader>
        <DestructiveDialogFooter
          onCancel={() => setOpen(false)}
          onConfirm={handleUnlink}
          isPending={isPending}
          confirmText={`Unlink ${label}`}
        />
      </DialogContent>
    </Dialog>
  )
}
