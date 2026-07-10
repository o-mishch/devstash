'use client'

import { useCallback } from 'react'
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
  // Narrow selectors (not the whole store object) so each field is read independently,
  // matching the item-row.tsx / image-card.tsx pattern used elsewhere.
  const isOpen = useUpgradePromptStore((state) => state.isOpen)
  const title = useUpgradePromptStore((state) => state.title)
  const description = useUpgradePromptStore((state) => state.description)
  const onUpgrade = useUpgradePromptStore((state) => state.onUpgrade)
  const closePrompt = useUpgradePromptStore((state) => state.closePrompt)

  const handleUpgrade = useCallback(() => {
    onUpgrade?.()
    closePrompt()
    router.push('/upgrade')
  }, [onUpgrade, closePrompt, router])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closePrompt()
      }
    },
    [closePrompt],
  )

  return (
    <>
      {children}
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="size-5 text-primary" />
            </div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
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
            {/* closePrompt (`() => void`) passed directly — no wrapper closure needed */}
            <Button variant="outline" onClick={closePrompt}>
              Cancel
            </Button>
            <Button onClick={handleUpgrade}>Upgrade to Pro</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
