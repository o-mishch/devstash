'use client'

import { useRouter } from 'next/navigation'
import { Lock, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import type { WithChildren } from '@/types/common'

const PRO_FEATURES = [
  'Unlimited items',
  'Unlimited collections',
  'File & image uploads',
]

export function UpgradePromptProvider({ children }: WithChildren) {
  const router = useRouter()
  const store = useUpgradePromptStore()

  function handleUpgrade() {
    store.onUpgrade?.()
    store.closePrompt()
    router.push('/upgrade')
  }

  return (
    <>
      {children}
      <Dialog
        open={store.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            store.closePrompt()
          }
        }}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="size-5 text-primary" />
            </div>
            <DialogTitle>{store.title}</DialogTitle>
            <DialogDescription>{store.description}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 py-1">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => store.closePrompt()}
            >
              Cancel
            </Button>
            <Button onClick={handleUpgrade}>Upgrade to Pro</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
