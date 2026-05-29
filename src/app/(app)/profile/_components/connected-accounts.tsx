'use client'

import { useState, useTransition } from 'react'
import type { ComponentType } from 'react'
import { toast } from 'sonner'
import { Mail, Unlink, Globe } from 'lucide-react'
import { GitHubIcon } from '@/components/icons/github'
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
import { PROVIDER_LABELS } from '@/lib/utils'
import type { LinkedAccount } from '@/lib/db/profile'

interface ConnectedAccountsProps {
  hasPassword: boolean
  accounts: LinkedAccount[]
}

interface ProviderMeta {
  Icon: ComponentType<{ className?: string }>
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  github: { Icon: GitHubIcon },
}

function EmailRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <Mail className="size-4 shrink-0 text-muted-foreground" />
        <span>Email &amp; Password</span>
      </div>
      <span className="text-xs text-muted-foreground">Connected</span>
    </div>
  )
}

interface ProviderAccountRowProps {
  account: LinkedAccount
  canUnlink: boolean
  onUnlinked: (id: string) => void
}

function ProviderAccountRow({ account, canUnlink, onUnlinked }: ProviderAccountRowProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = PROVIDER_META[account.provider]
  const label = PROVIDER_LABELS[account.provider] ?? account.provider
  const Icon = meta?.Icon ?? Globe

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkProviderAction(account.id)
      if (result.status === 'ok') {
        toast.success(`${label} account unlinked.`)
        setOpen(false)
        onUnlinked(account.id)
      } else {
        toast.error(result.message ?? 'Failed to unlink account.')
      }
    })
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <span className="text-muted-foreground"><Icon className="size-4 shrink-0" /></span>
        <span>{label}</span>
      </div>
      {canUnlink ? (
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
      ) : (
        <span className="text-xs text-muted-foreground">Connected</span>
      )}
    </div>
  )
}

export function ConnectedAccounts({ hasPassword, accounts: initialAccounts }: ConnectedAccountsProps) {
  const [accounts, setAccounts] = useState(initialAccounts)

  const totalMethods = (hasPassword ? 1 : 0) + accounts.length

  function handleUnlinked(id: string) {
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="space-y-2">
      {hasPassword && <EmailRow />}
      {accounts.map((account) => (
        <ProviderAccountRow
          key={account.id}
          account={account}
          canUnlink={totalMethods > 1}
          onUnlinked={handleUnlinked}
        />
      ))}
    </div>
  )
}
