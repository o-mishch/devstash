'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { motion, AnimatePresence, LayoutGroup } from 'motion/react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { useDroppable } from '@dnd-kit/react'
import { move } from '@dnd-kit/helpers'
import { PointerSensor, PointerActivationConstraints, KeyboardSensor } from '@dnd-kit/dom'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/react'
import { cn, getTypeLabel } from '@/lib/utils'
import { ITEM_TYPES_WITH_CONTENT, SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { CollapseChevron } from '@/components/shared/collapse-chevron'
import { Button } from '@/components/ui/button'
import { Trash2, Archive } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  useBrainDumpStream,
  usePatchBrainDumpDraftItem,
  useBulkCommitBrainDumpDrafts,
  useCommitBrainDumpJob,
  useEmptyBrainDumpTrash,
  useDiscardBrainDumpJob,
  useReparseBrainDumpJob,
  type BrainDumpDraftItem,
  type BrainDumpStreamSeed,
} from '@/hooks/use-brain-dump'
import { ParseProgress } from '@/components/parse/parse-progress'
import { ParseDraftCard } from '@/components/parse/parse-draft-card'
import { ParseCollectionTarget } from '@/components/parse/parse-collection-target'
import { BentoMasonry, type BentoMasonryTile } from '@/components/parse/bento-masonry'
import type { CollectionPickerItem } from '@/types/collection'

// The splitter only ever produces these five text types (file/image need an upload), so they are the
// buckets. A draft with any other type is shown under "note" (the catch-all), mirroring the server.
const BUCKETS = ['snippet', 'command', 'prompt', 'note', 'link'] as const
// Trash is a pseudo-bucket: trashed drafts land here regardless of type (soft delete). It is never an
// `itemTypeName` — a draft's type is preserved while it sits in trash so a restore keeps it.
const TRASH = 'trash'
const GROUPS = [...BUCKETS, TRASH] as const
type Group = (typeof GROUPS)[number]
type Columns = Record<Group, string[]>

// A cross-bucket move staged for confirmation (a drop into Links that would discard the draft's
// content). Holds just what `persistMove` needs so the confirm dialog can run or revert it.
interface PendingMove {
  id: string
  from: Group
  to: Group
}

function bucketOf(itemTypeName: string): Group {
  return (BUCKETS as readonly string[]).includes(itemTypeName) ? (itemTypeName as Group) : 'note'
}

// The group a draft belongs in right now: Trash if soft-deleted, otherwise its type bucket.
function groupOf(item: BrainDumpDraftItem): Group {
  return item.trashed ? TRASH : bucketOf(item.itemTypeName)
}

function emptyColumns(): Columns {
  return { snippet: [], command: [], prompt: [], note: [], link: [], trash: [] }
}

// Reconcile the bucket columns with the live items: each draft is authoritatively placed in its
// current group (so button trash/restore relocates it), while existing in-group order is preserved
// (so drag ordering and stream order survive). New ids are appended to their group.
function syncColumns(prev: Columns, items: BrainDumpDraftItem[]): Columns {
  const liveById = new Map(items.map((item) => [item.id, item]))
  const next = emptyColumns()
  GROUPS.forEach((group) => {
    next[group] = prev[group].filter((id) => {
      const item = liveById.get(id)
      return item ? groupOf(item) === group : false
    })
  })
  const placed = new Set(Object.values(next).flat())
  items.forEach((item) => {
    if (!placed.has(item.id)) next[groupOf(item)].push(item.id)
  })
  return next
}

// The whole draft card is the drag source, and a plain press on it opens the editor. These activation
// constraints are what separate the two intents: a mouse/pen drag starts only after the pointer moves
// 5px (a click that doesn't move never drags → it opens). On touch we return BOTH a Delay and a
// Distance constraint — dnd-kit OR-combines them (the first to fire wins, the rest are short-circuited),
// so a drag begins on EITHER a 250ms press-and-hold OR an intentional ≥12px swipe. That lets a finger
// press-then-immediately-swipe drag at once (no hold wait), while a quick stationary tap (no move,
// release before 250ms) still opens the editor. The Delay's tolerance (12px) matches the Distance
// value so finger jitter during a hold doesn't prematurely abort the hold path. `preventActivation`
// lets the action buttons (marked `data-no-drag`) keep their native click without ever starting a
// drag. KeyboardSensor is kept so the board stays keyboard-operable.
const boardSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === 'touch') {
        return [
          new PointerActivationConstraints.Delay({ value: 250, tolerance: 12 }),
          new PointerActivationConstraints.Distance({ value: 12 }),
        ]
      }
      return [new PointerActivationConstraints.Distance({ value: 5 })]
    },
    preventActivation: (event) =>
      event.target instanceof Element && event.target.closest('[data-no-drag]') !== null,
  }),
  KeyboardSensor,
]

interface ParseReviewBoardProps {
  jobId: string
  collections: CollectionPickerItem[]
  initialCollectionName: string | null
  initialCollectionIds: string[]
  /** Server-fetched snapshot pre-populates the stream hook to avoid an intermediate flash on mount. */
  initialSnapshot: BrainDumpStreamSeed
  /** Draft item id to scroll into view and highlight on mount (from `?item=` deep-link). */
  highlightItemId?: string
  /** The "Saved as …" source banner, rendered on one row with the progress bar (stacked on mobile). */
  sourceBanner?: ReactNode
}

export function ParseReviewBoard({
  jobId,
  collections,
  initialCollectionName,
  initialCollectionIds,
  initialSnapshot,
  highlightItemId,
  sourceBanner,
}: ParseReviewBoardProps) {
  const router = useRouter()
  const stream = useBrainDumpStream(jobId, initialSnapshot)
  const patchDraft = usePatchBrainDumpDraftItem()
  const bulkCommit = useBulkCommitBrainDumpDrafts()
  const commitJob = useCommitBrainDumpJob()
  const emptyTrash = useEmptyBrainDumpTrash()
  const discardJob = useDiscardBrainDumpJob()
  const reparseJob = useReparseBrainDumpJob()
  const [committing, setCommitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [reparsing, setReparsing] = useState(false)
  // Closed-job History mode: after the last trashed draft is committed/deleted, offer to delete the now-
  // empty history record (committed items stay). Null = dialog closed.
  const [deleteJobPrompt, setDeleteJobPrompt] = useState(false)
  // "Delete all" (empty trash) confirm dialog — permanent removal can't be undone, so the bucket action
  // opens this instead of deleting immediately.
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false)
  // A drag into the Links bucket from a content-bearing type drops the draft's content (a `link` item
  // has no content field). We stage that move here and confirm the loss before persisting; null = no
  // pending move. Cancel reverts the optimistic reflow back to the origin bucket.
  const [pendingLinkMove, setPendingLinkMove] = useState<PendingMove | null>(null)
  const [columns, setColumns] = useState<Columns>(() =>
    syncColumns(emptyColumns(), initialSnapshot.items),
  )
  // True while a dnd-kit drag is in flight. Motion's layout/layoutId animation is suppressed during a
  // drag so it doesn't fight dnd-kit's live pointer-follow (the cross-bucket GLIDE is for button-driven
  // moves and the drop-settle, not for the frame-by-frame drag itself).
  const [dragging, setDragging] = useState(false)
  // Number of bulk fan-outs (Save all / Restore all) in flight. A counter, not a boolean, so two
  // overlapping fan-outs don't let the first to finish re-enable the bulk buttons while the second is
  // still running (each increments on entry, decrements on exit). `bulkBusy` is derived from it below.
  const [bulkInFlight, setBulkInFlight] = useState(0)
  const trackBulk = useCallback((delta: number) => setBulkInFlight((n) => n + delta), [])
  const bulkBusy = bulkInFlight > 0
  // Number of draft patches/deletes in flight (drag reclassify + per-card trash/restore/delete). Empty
  // Trash is blocked while > 0 so a still-uncommitted restore can't be deleted out from under the user.
  const [pendingPatches, setPendingPatches] = useState(0)
  const trackPatch = useCallback((delta: number) => setPendingPatches((n) => n + delta), [])

  // Draft ids whose last bulk-commit attempt failed — those cards stay on the board (only succeeded ids
  // are removed) and would otherwise look identical to untouched ones. We flash an error ring on them and
  // clear it the moment that card succeeds at its next action (commit/trash/restore/edit).
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set())
  const markFailed = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setFailedIds((prev) => new Set([...prev, ...ids]))
  }, [])
  const clearFailed = useCallback((id: string) => {
    setFailedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Disclose a token-capped / window-truncated run the moment the stream reports it (the source banner
  // shows the same notice persistently on reload). Toast once per board mount.
  const truncationToasted = useRef(false)
  useEffect(() => {
    if (stream.truncated && !truncationToasted.current) {
      truncationToasted.current = true
      toast.info('Some of your source was not parsed into items — re-open the source to review the rest.')
    }
  }, [stream.truncated])

  const itemsById = useMemo(() => new Map(stream.items.map((item) => [item.id, item])), [stream.items])

  // Enter-fade gating. A card's `initial` fade must replay ONLY for a genuinely new draft (streamed in /
  // first seen) — never when an existing card hops buckets (button restore/trash/reclassify). On a
  // cross-bucket move the card briefly lives in BOTH the origin bucket's `AnimatePresence` (lingering to
  // play its `exit`) and the destination's (a fresh mount): if that fresh mount replays `initial: opacity
  // 0`, the moved card visibly blinks (disappear → reappear) while the `layoutId` glide runs. We keep the
  // fade only for first-seen ids. `seenCardIds` accumulates every id ever rendered (seeded from the
  // initial snapshot); `newCardIds` is the set that should still fade this commit. Both are updated in the
  // render-phase transition block below (alongside `syncedItems`) — NOT an effect — so the deciding value
  // is committed with the mount, not cleared a render later.
  const [seenCardIds, setSeenCardIds] = useState<Set<string>>(
    () => new Set(initialSnapshot.items.map((item) => item.id)),
  )
  const [newCardIds, setNewCardIds] = useState<Set<string>>(() => new Set())

  // "Save all N" and the progress count reflect only committable (non-trashed) drafts.
  const committableCount = useMemo(() => stream.items.filter((item) => !item.trashed).length, [stream.items])

  // Closed-job History mode: offer to delete the now-empty history record when its Trash bucket
  // transitions from non-empty to empty (last trashed draft committed/deleted). Driven off the live
  // trashed count via a transition-detecting effect — NOT a per-card closure read of `columns.trash`,
  // which goes stale when two removals settle back-to-back. The previous-count ref makes it fire only on
  // the >0 → 0 edge, never on an already-empty closed job loaded fresh.
  const trashedCount = useMemo(() => stream.items.filter((item) => item.trashed).length, [stream.items])
  const prevTrashedCount = useRef(trashedCount)
  useEffect(() => {
    if (stream.status === 'closed' && prevTrashedCount.current > 0 && trashedCount === 0) {
      setDeleteJobPrompt(true)
    }
    prevTrashedCount.current = trashedCount
  }, [stream.status, trashedCount])

  // Keep columns in sync with the live stream (appends, deletes) by adjusting state during render
  // when the items identity changes — React's recommended alternative to a setState-in-effect. Drag
  // reorders live in `columns` and survive because synced ids are already "known".
  const [syncedItems, setSyncedItems] = useState(stream.items)
  if (syncedItems !== stream.items) {
    setSyncedItems(stream.items)
    setColumns((prev) => syncColumns(prev, stream.items))
    // Drop error rings for drafts that have since left the stream so the set can't grow unbounded.
    setFailedIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(stream.items.map((item) => item.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
    // Recompute which ids are first-seen this commit (those still get the enter fade) and fold them into
    // the seen set so a later bucket hop doesn't re-fade them — see `newCardIds`/`seenCardIds` above.
    const fresh = new Set(stream.items.filter((item) => !seenCardIds.has(item.id)).map((item) => item.id))
    setNewCardIds(fresh)
    if (fresh.size > 0) setSeenCardIds((prev) => new Set([...prev, ...fresh]))
  }

  // Mirrors the latest reflowed `columns` so `handleDragEnd` can read the post-drag arrangement
  // synchronously. The `columns` *state* lags at drag-end (the `handleDragOver` `setColumns` updates
  // haven't committed/closed over yet), and dnd-kit's own `source.group`/drop target unreliably report
  // the destination when a card is dropped onto an empty bucket (tiny/zero-height droppable, no sibling
  // draft to sort against). The ref is updated inside the same `move()` call that drives the visual, so
  // it always holds exactly where the card was last placed — the single source of truth for persist.
  const columnsRef = useRef<Columns>(columns)
  useEffect(() => {
    columnsRef.current = columns
  }, [columns])

  // The bucket a dragged card started in, captured at drag start from the ref (the rendered placement),
  // so origin and destination are both read from `columns` and can't desync from each other.
  const dragOriginGroup = useRef<Group | null>(null)
  // The id of the card currently being dragged (null when idle). Used to highlight the WHOLE destination
  // bucket — `useDroppable`'s `isDropTarget` only fires when the pointer is over the column's own box (the
  // header strip), not when it's over a card sortable in the middle of the bucket (that card wins the
  // collision). Deriving the active bucket from where the card sits in the live reflow highlights the
  // bucket consistently across its entire area.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const activeGroup = useMemo(
    () => (draggingId ? (GROUPS.find((g) => columns[g].includes(draggingId)) ?? null) : null),
    [draggingId, columns],
  )

  const handleDragStart = (event: DragStartEvent) => {
    setDragging(true)
    const id = event.operation.source ? String(event.operation.source.id) : null
    setDraggingId(id)
    dragOriginGroup.current = id
      ? (GROUPS.find((g) => columnsRef.current[g].includes(id)) ?? null)
      : null
  }

  // Reflow the columns live as a card is dragged across buckets (canonical @dnd-kit/react multi-list
  // pattern), so the user sees the card relocate during the drag — `handleDragEnd` only persists. Keep
  // `columnsRef` in lockstep with the reflow so the drop handler reads the final placement immediately.
  const handleDragOver = (event: DragOverEvent) => {
    const { source } = event.operation
    if (!source || !isSortable(source)) return
    setColumns((prev) => {
      const next = move(prev, event)
      columnsRef.current = next
      return next
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(false)
    setDraggingId(null)
    const { source } = event.operation
    if (!source || !isSortable(source)) return

    // The arrangement was already applied in `handleDragOver`; on cancel, rebuild from the
    // authoritative items to undo the optimistic reflow.
    if (event.canceled) {
      setColumns((prev) => syncColumns(prev, stream.items))
      return
    }

    // Resolve origin and destination from `columnsRef` — the post-reflow placement that `move()` drove
    // during the drag. This is the authoritative answer for an empty-bucket drop, where dnd-kit's
    // `source.group`/drop target stay on the origin (no sibling draft to sort against) yet the card was
    // visually relocated. `from` was snapshotted at drag start; `to` is where the card sits now.
    const id = String(source.id)
    const from = dragOriginGroup.current
    dragOriginGroup.current = null
    const to = GROUPS.find((g) => columnsRef.current[g].includes(id)) ?? null
    if (!from || !to || from === to) return // pure reorder / no real move — not persisted

    // Dropping a content-bearing draft into Links discards its content (a `link` item has no content).
    // Stage the move and confirm the loss first; the optimistic reflow has already shown the card in
    // Links, so Cancel reverts it. An empty-content draft (or a move out of Trash, etc.) loses nothing
    // and persists straight through.
    const losesContent =
      to === 'link' &&
      from !== TRASH &&
      ITEM_TYPES_WITH_CONTENT.has(from) &&
      Boolean(itemsById.get(id)?.content?.trim())
    if (losesContent) {
      setPendingLinkMove({ id, from, to })
      return
    }

    persistMove(id, from, to)
  }

  // Optimistically reclassify/trash a dropped draft and persist it, reverting the draft fields and the
  // bucket columns if the PATCH fails. Split out of `handleDragEnd` so the Links content-loss confirm
  // dialog can run the exact same move after the user accepts.
  const persistMove = (id: string, from: Group, to: Group) => {
    let patch: Partial<BrainDumpDraftItem>
    let revert: Partial<BrainDumpDraftItem>
    if (to === TRASH) {
      patch = { trashed: true }
      revert = { trashed: false }
    } else if (from === TRASH) {
      // Restore out of Trash reclassifies to the destination bucket; on failure revert to the draft's
      // real prior type, not the `'trash'` pseudo-bucket (which is not a valid item type and would
      // corrupt the draft — `bucketOf('trash')` falls through to `note`).
      const priorType = itemsById.get(id)?.itemTypeName ?? to
      patch = { trashed: false, itemTypeName: to }
      revert = { trashed: true, itemTypeName: priorType }
    } else {
      patch = { itemTypeName: to }
      revert = { itemTypeName: from }
    }

    stream.applyPatch(id, patch)
    trackPatch(1)
    void patchDraft(jobId, id, patch)
      .then((result) => {
        if (!result.ok) {
          toast.error(to === TRASH ? 'Could not move to trash' : 'Could not move card')
          stream.applyPatch(id, revert)
          setColumns((prev) => syncColumns(prev, stream.items))
        }
      })
      .finally(() => trackPatch(-1))
  }

  // Optimistic trash/restore for the per-card Delete/Restore actions — reuse `persistMove` so a card-driven
  // soft-delete behaves exactly like a drag into/out of the Trash bucket (optimistic reflow + revert on
  // failure), instead of the card's old pessimistic await-then-apply spinner. `from`/`to` are derived from
  // the draft's current placement: trash sends its type bucket → TRASH, restore sends TRASH → its type
  // bucket. Clears any failed-ring on this card (a successful action supersedes the prior failure). Plain
  // consts (not memoized) so they close over the current-render `persistMove`/`stream`, like `persistMove`.
  const optimisticTrash = (item: BrainDumpDraftItem) => {
    clearFailed(item.id)
    persistMove(item.id, bucketOf(item.itemTypeName), TRASH)
  }
  const optimisticRestore = (item: BrainDumpDraftItem) => {
    clearFailed(item.id)
    persistMove(item.id, TRASH, bucketOf(item.itemTypeName))
  }

  // Confirm the Links content-loss dialog: persist the staged move (server nulls the content on the
  // type change). Then clear the pending state.
  const confirmLinkMove = () => {
    if (!pendingLinkMove) return
    const { id, from, to } = pendingLinkMove
    setPendingLinkMove(null)
    persistMove(id, from, to)
  }

  // Cancel the Links content-loss dialog: revert the optimistic reflow that already moved the card into
  // the Links bucket, restoring it to its origin bucket from the authoritative stream.
  const cancelLinkMove = () => {
    setPendingLinkMove(null)
    setColumns((prev) => syncColumns(prev, stream.items))
  }

  const commitAll = async () => {
    setCommitting(true)
    const result = await commitJob(jobId)
    setCommitting(false)
    if (!result.ok) {
      toast.error(result.message ?? 'Could not save items')
      return
    }
    if (result.partial) {
      toast.warning(
        `Saved ${result.created} of ${result.total} item${result.total === 1 ? '' : 's'}. Fix the rest and try again.`,
      )
      return
    }
    toast.success(`Saved ${result.created} item${result.created === 1 ? '' : 's'} to your stash`)
    // v2.5: a full commit always closes the job (history stub) — redirect to the dashboard regardless of
    // entry point (matches per-item auto-close). A non-partial success is always closed, so no fallback.
    if (result.closed) router.push('/dashboard')
  }

  const discard = async () => {
    setDiscarding(true)
    const ok = await discardJob(jobId)
    if (!ok) {
      setDiscarding(false)
      toast.error('Could not discard the job')
      return
    }
    toast.success('Discarded. Your source is still in your stash.')
    router.push('/parse')
  }

  // Closed-job History mode: delete the now-empty history record (reuses the discard endpoint; committed
  // items are untouched). Routes back to /parse where the History list lives.
  const deleteClosedJob = async () => {
    setDeleteJobPrompt(false)
    const ok = await discardJob(jobId)
    if (!ok) {
      toast.error('Could not delete the history record')
      return
    }
    toast.success('History record deleted. Your saved items are untouched.')
    router.push('/parse')
  }

  const reparse = async () => {
    setReparsing(true)
    try {
      const result = await reparseJob(jobId)
      if (!result.ok || !result.jobId) {
        toast.error(result.message ?? 'Could not re-parse the source')
        return
      }
      toast.success('Started a fresh parse job')
      router.push(`/parse/${result.jobId}`)
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.')
    } finally {
      setReparsing(false)
    }
  }

  // "Delete all" in the Trash bucket — permanently empties it. Reached only via the confirm dialog
  // (irreversible), so it closes that dialog as it runs.
  const onEmptyTrash = async () => {
    setDeleteAllConfirmOpen(false)
    const trashedIds = columns.trash
    if (trashedIds.length === 0) return
    // Block while any patch is in flight: a just-restored draft may still be `trashed` server-side, and
    // empty-trash deletes by that flag — wait so the restore commits first and the draft survives.
    if (pendingPatches > 0) {
      toast.info('Finishing up — try emptying the trash again in a moment')
      return
    }
    const ok = await emptyTrash(jobId)
    if (!ok) {
      toast.error('Could not empty trash')
      return
    }
    trashedIds.forEach((id) => stream.removeItem(id))
    toast.success(`Deleted ${trashedIds.length} item${trashedIds.length === 1 ? '' : 's'}`)
  }

  // "Restore all" in the Trash bucket — fans out the per-item restore (clear `trashed`) over every
  // trashed draft, mirroring `saveBucket`'s fan-out. Optimistic per draft so each card flies back to its
  // type bucket immediately; a failed restore reverts that one card and toasts.
  const restoreAllTrash = async () => {
    const trashedIds = [...columns.trash]
    if (trashedIds.length === 0) return
    trackBulk(1)
    trackPatch(1)
    const results = await Promise.allSettled(
      trashedIds.map(async (id) => {
        stream.applyPatch(id, { trashed: false })
        const result = await patchDraft(jobId, id, { trashed: false })
        if (!result.ok) {
          stream.applyPatch(id, { trashed: true })
          throw new Error(id)
        }
        return id
      }),
    )
    trackPatch(-1)
    trackBulk(-1)
    const restored = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.length - restored
    if (restored > 0) toast.success(`Restored ${restored} item${restored === 1 ? '' : 's'}`)
    if (failed > 0) toast.error(`Could not restore ${failed} item${failed === 1 ? '' : 's'}`)
  }

  // Per-bucket "Save all in this bucket": fan out the per-item commit over every (non-trashed) draft in
  // the bucket, then drop the succeeded ids (the server deleted those drafts). The whole fan-out settles
  // FIRST, then auto-close is evaluated ONCE (the hook reports `closed` after all settle) — never
  // mid-batch. This is a bucket-level convenience, not item multi-select.
  const saveBucket = async (group: Group) => {
    const committable = columns[group].filter((id) => !itemsById.get(id)?.trashed)
    if (committable.length === 0) return
    trackBulk(1)
    trackPatch(1)
    const { succeeded, failed, closed } = await bulkCommit(jobId, committable)
    trackPatch(-1)
    trackBulk(-1)
    succeeded.forEach((id) => {
      stream.removeItem(id)
      clearFailed(id)
    })
    if (succeeded.length > 0) toast.success(`Saved ${succeeded.length} item${succeeded.length === 1 ? '' : 's'} to your stash`)
    if (failed.length > 0) {
      // Flash an error ring on the cards that stayed behind so they're distinguishable from untouched
      // ones (the aggregate toast alone doesn't say which); cleared on each card's next successful action.
      markFailed(failed)
      toast.error(`Could not save ${failed.length} item${failed.length === 1 ? '' : 's'}`)
    }
    // The save-all drained the last draft → the job closed; redirect to the dashboard (matches the full
    // "Save all" + per-item auto-close).
    if (closed) router.push('/dashboard')
  }

  // "Delete all" confirm — permanent emptying of the Trash bucket is irreversible. Rendered in both the
  // closed-job History view and the live board (both can show a Trash bucket).
  const deleteAllDialog = (
    <Dialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete everything in the Trash?</DialogTitle>
          <DialogDescription>
            All {columns.trash.length} draft{columns.trash.length === 1 ? '' : 's'} in the Trash will be
            permanently removed from this Brain Dump. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDeleteAllConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onEmptyTrash}>
            Delete all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // Content-loss confirm — moving a content-bearing draft into Links drops its content (Link items have
  // no content). Cancel reverts the optimistic move; only the live board can reach this (no Links bucket
  // in History mode).
  const linkMoveDialog = (
    <Dialog
      open={pendingLinkMove !== null}
      onOpenChange={(open) => {
        if (!open) cancelLinkMove()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Links and discard content?</DialogTitle>
          <DialogDescription>
            A link has no content field, so the text of
            {pendingLinkMove ? ` “${itemsById.get(pendingLinkMove.id)?.title ?? 'this draft'}”` : ' this draft'}{' '}
            will be removed when it becomes a link. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={cancelLinkMove}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={confirmLinkMove}>
            Move and discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // Closed-job History mode: the same board, but post-commit. Suppress the progress header / Resume /
  // Save-all / collection-target chrome and render ONLY the Trash bucket — each trashed draft stays
  // editable/committable (Restore is dropped here: it would move the draft into a type bucket this branch
  // never renders, hiding it — see `canRestore`). Committing the last trashed draft (per-item) prompts a
  // "delete the job?" confirm in the card; here we just show the History banner + the Trash column.
  if (stream.status === 'closed') {
    return (
      <div className="flex flex-col gap-4">
        <ParseHistoryBanner committedCount={stream.committedCount} committedByType={stream.committedByType} />
        <DragDropProvider sensors={boardSensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="columns-1 gap-3">
            <BucketColumn group={TRASH} count={columns.trash.length} isActive={activeGroup === TRASH} onEmptyTrash={() => setDeleteAllConfirmOpen(true)} saveAllBusy={bulkBusy}>
              <AnimatePresence mode="popLayout" initial={false}>
                {columns.trash.map((id, index) => {
                  const item = itemsById.get(id)
                  if (!item) return null
                  return (
                    <motion.div
                      key={id}
                      layout
                      initial={{ opacity: 0, scale: 0.92, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      <SortableCard
                        item={item}
                        index={index}
                        group={TRASH}
                        jobId={jobId}
                        canRestore={false}
                        highlight={highlightItemId === id}
                        failed={failedIds.has(id)}
                        onClearFailed={() => clearFailed(id)}
                        onTrash={optimisticTrash}
                        onRestore={optimisticRestore}
                        onPatchPending={trackPatch}
                        onEdited={(patch) => stream.applyPatch(id, patch)}
                        onRemoved={() => {
                          // The "delete the now-empty history record?" prompt is driven by the
                          // trashed-count transition effect above (robust against back-to-back removals),
                          // not a stale `columns.trash` read here.
                          stream.removeItem(id)
                        }}
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </BucketColumn>
          </div>
        </DragDropProvider>
        <Dialog open={deleteJobPrompt} onOpenChange={setDeleteJobPrompt}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this history record?</DialogTitle>
              <DialogDescription>
                The trash is now empty. You can delete this Brain Dump from your history — the items you
                already saved stay in your stash.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteJobPrompt(false)}>
                Keep
              </Button>
              <Button variant="destructive" size="sm" onClick={deleteClosedJob}>
                Delete record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {deleteAllDialog}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Source banner + progress share one row on sm+ (banner ~3/10, progress ~7/10); they stack
          below 640px so neither is cramped. Use flex-grow ratios on a 0 basis (not basis-30%/70% +
          shrink-0): fixed percentage bases plus the gap-4 would sum past 100% and, unable to shrink,
          overflow the container — making the progress card's right edge miss the full-width widgets below. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        {sourceBanner ? <div className="sm:min-w-0 sm:flex-[3]">{sourceBanner}</div> : null}
        <div className="sm:min-w-0 sm:flex-[7]">
          <ParseProgress
            phase={stream.phase}
            progress={stream.progress}
            count={committableCount}
            error={stream.error}
            committing={committing}
            discarding={discarding}
            reparsing={reparsing}
            onResume={stream.resume}
            onCommitAll={commitAll}
            onDiscard={discard}
            onReparse={reparse}
          />
        </div>
      </div>

      <ParseCollectionTarget
        jobId={jobId}
        collections={collections}
        initialName={initialCollectionName}
        initialIds={initialCollectionIds}
      />

      <DragDropProvider sensors={boardSensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        {/* Bento masonry: each bucket is a measured tile, absolutely positioned and packed by height;
            a bucket growing/shrinking or hopping columns animates its (x, y) (BentoMasonry). The single
            LayoutGroup spanning every bucket is what lets a card GLIDE from one bucket to another: each
            card carries a board-wide `layoutId`, so when it leaves bucket A and reappears in bucket B
            (trash/restore/reclassify), Motion animates it between the two positions instead of
            exit-here / enter-there. */}
        <LayoutGroup>
          <BentoMasonry
            tiles={GROUPS.map<BentoMasonryTile>((group) => ({
              key: group,
              content: (
                <BucketColumn
                  group={group}
                  count={columns[group].length}
                  isActive={activeGroup === group}
                  onEmptyTrash={group === TRASH ? () => setDeleteAllConfirmOpen(true) : undefined}
                  onRestoreAll={group === TRASH ? restoreAllTrash : undefined}
                  onSaveAll={group !== TRASH && columns[group].length > 0 ? () => saveBucket(group) : undefined}
                  saveAllBusy={bulkBusy}
                >
                  {/* mode="sync" (not popLayout): when a card's id moves from this bucket's list into
                      another bucket's list (Delete/Restore/reclassify), the SAME `layoutId` unmounts here
                      and remounts there in one commit. Motion promotes the shared identity and FLIES the
                      card from its old measured box to the new one across buckets. popLayout would instead
                      detach the leaving node and run its `exit`, killing the hand-off — so the card would
                      vanish here and pop in there. The brief crossfade is the documented shared-layout
                      behaviour. */}
                  <AnimatePresence mode="sync" initial={false}>
                    {columns[group].map((id, index) => {
                      const item = itemsById.get(id)
                      if (!item) return null
                      return (
                        <motion.div
                          key={id}
                          // Board-wide shared identity → cross-bucket FLIGHT (see LayoutGroup above).
                          // Suppressed while dragging so Motion's projection doesn't fight dnd-kit's
                          // live pointer-follow; the flight is for button moves + the drop-settle.
                          layoutId={dragging ? undefined : `draft-${id}`}
                          layout={!dragging}
                          // Fade in only a genuinely new draft; an already-seen card that hopped buckets
                          // mounts solid so it just glides (no disappear/reappear blink) — see `newCardIds`.
                          initial={newCardIds.has(id) ? { opacity: 0, scale: 0.92 } : false}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.92 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.8 }}
                        >
                          <SortableCard
                            item={item}
                            index={index}
                            group={group}
                            jobId={jobId}
                            highlight={highlightItemId === id}
                            failed={failedIds.has(id)}
                            onClearFailed={() => clearFailed(id)}
                            onTrash={optimisticTrash}
                            onRestore={optimisticRestore}
                            onPatchPending={trackPatch}
                            onEdited={(patch) => stream.applyPatch(id, patch)}
                            onRemoved={() => stream.removeItem(id)}
                          />
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </BucketColumn>
              ),
            }))}
          />
        </LayoutGroup>
      </DragDropProvider>
      {deleteAllDialog}
      {linkMoveDialog}
    </div>
  )
}

interface BucketColumnProps {
  group: Group
  count: number
  // True when the card currently being dragged sits in this bucket (per the live reflow). Highlights the
  // WHOLE bucket — `isDropTarget` alone only fires over the column's bare box (header), not when the
  // pointer is over a card in the middle (that card wins the collision), leaving the border un-highlighted.
  isActive?: boolean
  // Trash-bucket bulk actions (both absent for non-Trash / empty Trash): permanently delete all, or
  // restore all back to their type buckets. `onEmptyTrash` opens a confirm dialog (irreversible).
  onEmptyTrash?: () => void
  onRestoreAll?: () => void
  // Per-bucket "Save all in this bucket" — commits every draft in the bucket. Absent for Trash / empty.
  onSaveAll?: () => void
  // Shared busy flag for the Trash/Save-all fan-outs (Restore all + Save all).
  saveAllBusy?: boolean
  children: ReactNode
}

function BucketColumn({ group, count, isActive, onEmptyTrash, onRestoreAll, onSaveAll, saveAllBusy, children }: BucketColumnProps) {
  const { ref, isDropTarget } = useDroppable({ id: group, type: 'column', accept: 'draft' })
  const isTrash = group === TRASH
  // Highlight when the column is the pointer's drop target OR when the dragged card already sits in this
  // bucket (covers a hover over a card in the middle, where the card — not the column — is the target).
  const highlighted = isDropTarget || isActive
  // Each bucket collapses (like the dashboard group widgets), so the user can fold buckets they're done
  // with. The droppable ref stays on the outer element, so a card can still be dragged onto a collapsed
  // bucket's header to drop into it.
  const [open, setOpen] = useState(true)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        ref={ref}
        // The accent feeds the colored left border (matching the app's item cards / unified card system):
        // a 2px left border, neutral at rest, lighting up to the bucket's type color on hover (Trash uses
        // the destructive color).
        style={{ '--card-accent': isTrash ? 'var(--destructive)' : (SYSTEM_TYPE_COLORS[group] ?? 'var(--primary)') } as CSSProperties}
        className={cn(
          'flex flex-col gap-2 rounded-xl border border-border/70 border-l-2 bg-muted/20 p-2.5 transition-colors hover:border-l-[var(--card-accent)]',
          isTrash && 'border-dashed',
          // Plain mouse-hover affordance — signals the bucket is one unit / a drop zone before a drag
          // starts: the type-accent left border above lights up (matching the app's cards) plus a faint
          // surface lift. NOT a whole-border brighten — that would override the accent left edge (an
          // all-sides `hover:border-border` wins the equal-specificity clash against `hover:border-l-*`).
          'hover:bg-muted/40',
          // Drop-target / active-drag highlight (primary accent). Also re-asserted under `hover:` so it
          // wins when the pointer is BOTH dragging over and hovering the bucket — otherwise the equal-
          // specificity `hover:bg-muted/40` above could override the drag feedback.
          highlighted && 'border-primary/60 bg-primary/5 hover:border-primary/60 hover:bg-primary/5',
        )}
      >
        <div className="group flex items-center gap-2 px-1 pb-1">
          <CollapsibleTrigger
            aria-label={`Toggle ${isTrash ? 'Trash' : getTypeLabel(group)} bucket`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isTrash ? (
              <Trash2 className="size-4 text-destructive" />
            ) : (
              <ItemTypeIcon typeName={group} className="size-4" />
            )}
            <span className="text-sm font-semibold">{isTrash ? 'Trash' : getTypeLabel(group)}</span>
            <CollapseChevron open={open} className="text-muted-foreground group-hover:text-foreground" />
            <span className="ml-auto rounded-full bg-muted px-2 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          </CollapsibleTrigger>
          {isTrash && count > 0 && onRestoreAll && (
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onRestoreAll} disabled={saveAllBusy}>
                        Restore all
                      </Button>
                    </span>
                  }
                />
                <TooltipContent className="max-w-[240px]">
                  Move every draft in the Trash back to its type bucket.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isTrash && count > 0 && onEmptyTrash && (
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={onEmptyTrash}
                        disabled={saveAllBusy}
                      >
                        Delete all
                      </Button>
                    </span>
                  }
                />
                <TooltipContent className="max-w-[240px]">
                  Permanently delete every draft in the Trash. This can’t be undone.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {onSaveAll && (
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onSaveAll} disabled={saveAllBusy}>
                        Save all
                      </Button>
                    </span>
                  }
                />
                <TooltipContent className="max-w-[240px]">
                  Commit every draft in the {getTypeLabel(group)} bucket into your stash at once.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <CollapsibleContent>
          {/* p-1 insets the cards from the panel edges: the collapsible panel is `overflow-hidden`
              (needed for its height animation), so without this inset the top card's hover lift
              (`card-interactive` -translate-y-1) and shadow get clipped at the panel's top edge —
              the head border visibly disappears on hover. The 4px inset also aligns the cards with
              the header's `px-1`. */}
          <div className="flex flex-col gap-2 p-1">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

interface ParseHistoryBannerProps {
  committedCount: number
  committedByType: Record<string, number> | null
}

// History banner shown atop a closed (committed) job's board. Summarizes the stub stats — total committed
// plus the per-type breakdown — and frames the leftover Trash bucket below as "still rescuable".
function ParseHistoryBanner({ committedCount, committedByType }: ParseHistoryBannerProps) {
  const byType = Object.entries(committedByType ?? {}).filter(([, n]) => n > 0)
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Archive className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Saved to your stash</p>
          <p className="text-xs text-muted-foreground">
            {committedCount} item{committedCount === 1 ? '' : 's'} committed from this Brain Dump. This is a
            history record — the source stays in your stash.
          </p>
        </div>
      </div>
      {byType.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {byType.map(([type, n]) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-xs"
            >
              <ItemTypeIcon typeName={type} className="size-3" />
              {getTypeLabel(type)} · {n}
            </span>
          ))}
        </div>
      )}
      {/* The Trash bucket below holds drafts the user discarded before committing — still editable,
          restorable, and committable, so nothing is permanently lost until they empty it. */}
    </div>
  )
}

interface SortableCardProps {
  item: BrainDumpDraftItem
  index: number
  group: Group
  jobId: string
  // False in closed-job History mode (only the Trash bucket renders, so restoring would hide the draft).
  canRestore?: boolean
  highlight?: boolean
  // True when this draft's last bulk-commit attempt failed — the card flashes an error ring.
  failed?: boolean
  // Clear this card's failed-ring (called by the card after its next successful action).
  onClearFailed?: () => void
  // Optimistic trash/restore via the board's `persistMove` (optimistic reflow + revert on failure),
  // replacing the card's old pessimistic await-then-apply flow.
  onTrash: (item: BrainDumpDraftItem) => void
  onRestore: (item: BrainDumpDraftItem) => void
  onPatchPending: (delta: number) => void
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
  onRemoved: () => void
}

function SortableCard({ item, index, group, jobId, canRestore = true, highlight, failed, onClearFailed, onTrash, onRestore, onPatchPending, onEdited, onRemoved }: SortableCardProps) {
  // No separate drag handle: the whole card is the sortable element (and thus the drag source), so a
  // press+move anywhere on the card drags it. A plain press (no move past the sensor's activation
  // distance) is a click that opens the editor — see ParseDraftCard.
  const { ref, isDragging } = useSortable({
    id: item.id,
    index,
    group,
    type: 'draft',
    accept: 'draft',
  })

  return (
    <ParseDraftCard
      jobId={jobId}
      item={item}
      inTrash={group === TRASH}
      canRestore={canRestore}
      highlight={highlight}
      failed={failed}
      onClearFailed={onClearFailed}
      onTrash={onTrash}
      onRestore={onRestore}
      rootRef={ref}
      isDragging={isDragging}
      onPatchPending={onPatchPending}
      onEdited={onEdited}
      onRemoved={onRemoved}
    />
  )
}
