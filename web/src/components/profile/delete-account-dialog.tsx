import { useState } from 'react'
import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useDeleteAccount } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * Confirm-and-delete dialog for the account. The backend's DELETE /me is session-scoped and needs
 * no password re-entry (unlike the legacy flow), so this is a single explicit confirmation.
 */
export function DeleteAccountDialog(): ReactNode {
  const [open, setOpen] = useState(false)
  const del = useDeleteAccount()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm">
            <Trash2 className="size-4" />
            Delete account
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This action is permanent. All your items, collections, and data will be deleted and
            cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={del.isPending}
            onClick={() => del.mutate({})}
          >
            {del.isPending ? 'Deleting…' : 'Delete account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
