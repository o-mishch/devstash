'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Star, Pin, Pencil, Trash2, XCircle, Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePatchItem, useRemoveItem, useToggleFavoriteInCache } from '@/hooks/use-infinite-items'
import { useRestrictedAction } from '@/hooks/use-restricted-action'
import { useStartBrainDumpFromSource, BRAIN_DUMP_UPGRADE_PROMPT } from '@/hooks/use-brain-dump'
import { useAiUsage } from '@/hooks/use-ai-usage'
import { CopyButton } from '@/components/shared/copy-button'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DestructiveDialogFooter } from '@/components/shared/destructive-dialog-footer'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { formatRenewIn } from '@/lib/utils/format'
import { api } from '@/lib/api/client'
import { useItemDrawerStore } from '@/stores/item-drawer'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { usePinnedItemsStore } from '@/stores/pinned-items'
import { useOptimisticToggle } from '@/hooks/use-optimistic-toggle'
import { ITEM_TYPES_WITH_FILE, PRO_ITEM_TYPE_NAMES } from '@/lib/utils/constants'
import { isParseSourceEligible } from '@/lib/utils/brain-dump-source'
import { ACTIONBAR_LABEL_CLASS } from '@/lib/utils/ui'
import { getDownloadUrl } from '@/lib/utils/url'
import type { LightItem, FullItem } from '@/types/item'

interface ItemDrawerActionBarProps {
  item: LightItem | FullItem
  isLight: boolean
  fullItem: FullItem | null
  onEdit: () => void
  onDeleted: () => void
}

export function ItemDrawerActionBar({ item, isLight, fullItem, onEdit, onDeleted }: ItemDrawerActionBarProps) {
  const patchItem = usePatchItem()
  const removeItem = useRemoveItem()
  const toggleFavoriteInCache = useToggleFavoriteInCache()
  const { setPinnedOverride, removePinnedOverride } = usePinnedItemsStore()
  const { closeDrawer } = useItemDrawerStore()
  const { isPro } = useAppUserFlagsStore()
  const { openPrompt } = useUpgradePromptStore()
  const startParse = useStartBrainDumpFromSource()
  const isRestricted = !isPro && PRO_ITEM_TYPE_NAMES.has(item.itemType.name)
  const canParse = isParseSourceEligible(item)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parseConfirmOpen, setParseConfirmOpen] = useState(false)

  // A Brain Dump job spends the hourly `aiBrainDump` token, so right after one parse the user is at 0
  // remaining until the slot renews. Disable + explain rather than letting the click 429. Fail open: a
  // non-Pro user (the meter is Pro-gated) or an unknown quota leaves Parse enabled and the server's 429
  // is the backstop. The meter is also what powers the rate-limit tooltip's renewal copy.
  const { data: aiUsage } = useAiUsage()
  const brainDumpQuota = aiUsage?.brainDump
  const parseRateLimited = isPro && brainDumpQuota != null && brainDumpQuota.remaining < 1

  // The Parse trigger gates before doing any work: a non-Pro click opens the upgrade prompt (no token
  // spent); a Pro click opens the confirm dialog (a parse uses one of the hourly runs, so we ask first).
  function openParse() {
    if (!isPro) {
      openPrompt(BRAIN_DUMP_UPGRADE_PROMPT)
      return
    }
    setParseConfirmOpen(true)
  }

  // Runs the actual parse after the user confirms. On success the hook toasts + routes to the review
  // board; keep the drawer (and its spinner) up until the call resolves so a failure can reset the busy
  // state, then close only on success where the drawer would otherwise linger over the /parse navigation.
  async function confirmParse() {
    setIsParsing(true)
    const result = await startParse(item.id)
    if (!result.ok) {
      setIsParsing(false)
      return
    }
    // Reset the busy state before closing rather than relying on the drawer unmounting to clear it —
    // robust if a future exit animation keeps this bar mounted briefly over the /parse navigation.
    setIsParsing(false)
    setParseConfirmOpen(false)
    closeDrawer()
  }
  const { showError: showEditError, flash: flashEditError } = useRestrictedAction({
    title: 'Pro feature',
    description: 'Editing files and images requires a Pro plan.',
    onUpgrade: closeDrawer,
  })

  const { value: isFavorite, toggle: handleFavoriteToggle } = useOptimisticToggle(
    item.isFavorite,
    async (next) => {
      const { error } = await api.PATCH('/items/{id}/favorite', {
        params: { path: { id: item.id } },
        body: { isFavorite: next },
      })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: (next) => {
        toggleFavoriteInCache(item, next)
      },
      errorLabel: 'Failed to toggle favorite',
    }
  )

  const { value: isPinned, toggle: handlePinToggle } = useOptimisticToggle(
    item.isPinned,
    async (next) => {
      const { error } = await api.PATCH('/items/{id}/pinned', {
        params: { path: { id: item.id } },
        body: { isPinned: next },
      })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: (next) => {
        patchItem(item.id, { isPinned: next })
        setPinnedOverride({ ...item, isPinned: next }, next)
      },
      errorLabel: 'Failed to toggle pin',
    }
  )

  const hasFile = ITEM_TYPES_WITH_FILE.has(item.itemType.name)
  let copyValue: string
  if (hasFile) {
    copyValue = getDownloadUrl(item.id, true)
  } else if (fullItem) {
    copyValue = fullItem.content ?? fullItem.url ?? fullItem.title
  } else {
    copyValue = item.url ?? item.title
  }

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/items/{id}', { params: { path: { id: item.id } } })
      if (error) throw new Error(error.message || 'Failed to delete item')
    },
    onSuccess: () => {
      toast.success('Item deleted')
      setDeleteDialogOpen(false)
      removeItem(item.id)
      removePinnedOverride(item.id)
      onDeleted()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete item')
    },
  })

  // The two Parse trigger variants — the active button, and a disabled clone wrapped in a span so the
  // rate-limit tooltip still resolves a hover target (Base UI tooltips need a non-disabled trigger).
  const parseButton = (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto text-primary hover:text-primary"
      disabled={isLight || isParsing}
      onClick={openParse}
    >
      {isParsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      <span className={ACTIONBAR_LABEL_CLASS}>Parse</span>
    </Button>
  )
  const parseButtonDisabled = (
    <span className="ml-auto inline-flex">
      <Button variant="ghost" size="sm" className="text-primary hover:text-primary" disabled>
        <Sparkles className="size-4" />
        <span className={ACTIONBAR_LABEL_CLASS}>Parse</span>
      </Button>
    </span>
  )

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLight}
        className={isFavorite ? 'text-yellow-500 hover:text-yellow-500' : ''}
        onClick={handleFavoriteToggle}
      >
        <Star className={`size-4 ${isFavorite ? 'fill-yellow-500' : ''}`} />
        <span className={ACTIONBAR_LABEL_CLASS}>{isFavorite ? 'Starred' : 'Favorite'}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLight}
        className={isPinned ? 'text-primary' : ''}
        onClick={handlePinToggle}
      >
        <Pin className={`size-4 ${isPinned ? 'fill-primary' : ''}`} />
        <span className={ACTIONBAR_LABEL_CLASS}>Pin</span>
      </Button>
      <CopyButton value={copyValue} text="Copy" textClassName={ACTIONBAR_LABEL_CLASS} isRestricted={isRestricted} onUpgrade={closeDrawer} />
      <Button variant="ghost" size="sm" onClick={(e) => {
        if (isRestricted) {
          e.preventDefault()
          flashEditError()
          return
        }
        onEdit()
      }} disabled={isLight}>
        {showEditError ? <XCircle className="size-4 text-destructive" /> : <Pencil className="size-4" />}
        <span className={ACTIONBAR_LABEL_CLASS}>Edit</span>
      </Button>
      {canParse && (
        // Tooltip scoped by the single TooltipProvider in DrawerLayout (this action bar only renders inside it).
        <Tooltip>
          <TooltipTrigger render={parseRateLimited ? parseButtonDisabled : parseButton} />
          <TooltipContent className={parseRateLimited ? 'max-w-[260px]' : undefined}>
            {parseRateLimited && brainDumpQuota
              ? `Brain Dump runs once an hour, and you’ve used this hour’s — ${formatRenewIn(brainDumpQuota.resetAt)}.`
              : 'Split this into ready-to-save items with AI'}
          </TooltipContent>
        </Tooltip>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className={canParse ? 'text-destructive hover:text-destructive' : 'ml-auto text-destructive hover:text-destructive'}
        onClick={() => setDeleteDialogOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete item?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {item.itemType.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DestructiveDialogFooter
            onCancel={() => setDeleteDialogOpen(false)}
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
            confirmText="Delete"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={parseConfirmOpen}
        onOpenChange={setParseConfirmOpen}
        title="Start Brain Dump?"
        description={`AI will split this ${item.itemType.name} into ready-to-save items. This uses one of your hourly Brain Dump runs.`}
        confirmLabel="Start Brain Dump"
        onConfirm={confirmParse}
        isPending={isParsing}
        cancelLabel="Cancel"
      />
    </>
  )
}
