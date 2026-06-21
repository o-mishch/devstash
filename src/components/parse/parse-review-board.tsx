'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'motion/react'
import { Trash2 } from 'lucide-react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable, isSortable } from '@dnd-kit/react/sortable'
import { useDroppable } from '@dnd-kit/react'
import { move } from '@dnd-kit/helpers'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/react'
import { cn, getTypeLabel } from '@/lib/utils'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Button } from '@/components/ui/button'
import {
  useBrainDumpStream,
  usePatchBrainDumpDraftItem,
  useCommitBrainDumpJob,
  useEmptyBrainDumpTrash,
  useDiscardBrainDumpJob,
  useReparseBrainDumpJob,
  type BrainDumpDraftItem,
} from '@/hooks/use-brain-dump'
import { ParseProgress } from '@/components/parse/parse-progress'
import { ParseDraftCard } from '@/components/parse/parse-draft-card'
import { ParseCollectionTarget } from '@/components/parse/parse-collection-target'
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

interface ParseReviewBoardProps {
  jobId: string
  collections: CollectionPickerItem[]
  initialCollectionName: string | null
  initialCollectionIds: string[]
}

export function ParseReviewBoard({
  jobId,
  collections,
  initialCollectionName,
  initialCollectionIds,
}: ParseReviewBoardProps) {
  const router = useRouter()
  const stream = useBrainDumpStream(jobId)
  const patchDraft = usePatchBrainDumpDraftItem()
  const commitJob = useCommitBrainDumpJob()
  const emptyTrash = useEmptyBrainDumpTrash()
  const discardJob = useDiscardBrainDumpJob()
  const reparseJob = useReparseBrainDumpJob()
  const [committing, setCommitting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [reparsing, setReparsing] = useState(false)
  const [columns, setColumns] = useState<Columns>(emptyColumns)
  // Number of draft patches/deletes in flight (drag reclassify + per-card trash/restore/delete). Empty
  // Trash is blocked while > 0 so a still-uncommitted restore can't be deleted out from under the user.
  const [pendingPatches, setPendingPatches] = useState(0)
  const trackPatch = useCallback((delta: number) => setPendingPatches((n) => n + delta), [])

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
  // "Save all N" and the progress count reflect only committable (non-trashed) drafts.
  const committableCount = useMemo(() => stream.items.filter((item) => !item.trashed).length, [stream.items])

  // Keep columns in sync with the live stream (appends, deletes) by adjusting state during render
  // when the items identity changes — React's recommended alternative to a setState-in-effect. Drag
  // reorders live in `columns` and survive because synced ids are already "known".
  const [syncedItems, setSyncedItems] = useState(stream.items)
  if (syncedItems !== stream.items) {
    setSyncedItems(stream.items)
    setColumns((prev) => syncColumns(prev, stream.items))
  }

  // Reflow the columns live as a card is dragged across buckets (canonical @dnd-kit/react multi-list
  // pattern), so the user sees the card relocate during the drag — `handleDragEnd` only persists.
  const handleDragOver = (event: DragOverEvent) => {
    const { source } = event.operation
    if (!source || !isSortable(source)) return
    setColumns((prev) => move(prev, event))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { source } = event.operation
    if (!source || !isSortable(source)) return

    // The arrangement was already applied in `handleDragOver`; on cancel, rebuild from the
    // authoritative items to undo the optimistic reflow.
    if (event.canceled) {
      setColumns((prev) => syncColumns(prev, stream.items))
      return
    }

    const { initialGroup, group } = source
    if (initialGroup === group) return // pure reorder — not persisted (cosmetic only)

    const id = String(source.id)
    const from = String(initialGroup)
    const to = String(group)

    // Trash transitions: drag into Trash soft-deletes; drag out restores AND reclassifies to the
    // target type bucket. A plain type→type move is a reclassification.
    let patch: Partial<BrainDumpDraftItem>
    let revert: Partial<BrainDumpDraftItem>
    if (to === TRASH) {
      patch = { trashed: true }
      revert = { trashed: false }
    } else if (from === TRASH) {
      patch = { trashed: false, itemTypeName: to }
      revert = { trashed: true, itemTypeName: from }
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

  const commitAll = async () => {
    const expected = committableCount
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
    if (expected > 0 && result.created === expected) router.push('/parse')
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

  const onEmptyTrash = async () => {
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

  return (
    <div className="flex flex-col gap-4">
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

      <ParseCollectionTarget
        jobId={jobId}
        collections={collections}
        initialName={initialCollectionName}
        initialIds={initialCollectionIds}
      />

      <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        {/* Bento masonry: buckets flow into CSS columns and pack by height; cards pop in within
            their bucket (Motion layout + AnimatePresence popLayout). */}
        <motion.div layoutScroll className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {GROUPS.map((group) => (
            <BucketColumn
              key={group}
              group={group}
              count={columns[group].length}
              onEmptyTrash={group === TRASH ? onEmptyTrash : undefined}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {columns[group].map((id, index) => {
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
                        group={group}
                        jobId={jobId}
                        onPatchPending={trackPatch}
                        onEdited={(patch) => stream.applyPatch(id, patch)}
                        onRemoved={() => stream.removeItem(id)}
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </BucketColumn>
          ))}
        </motion.div>
      </DragDropProvider>
    </div>
  )
}

interface BucketColumnProps {
  group: Group
  count: number
  onEmptyTrash?: () => void
  children: ReactNode
}

function BucketColumn({ group, count, onEmptyTrash, children }: BucketColumnProps) {
  const { ref, isDropTarget } = useDroppable({ id: group, type: 'column', accept: 'draft' })
  const isTrash = group === TRASH
  return (
    <div
      ref={ref}
      className={cn(
        'mb-3 flex break-inside-avoid flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-2.5 transition-colors',
        isTrash && 'border-dashed',
        isDropTarget && 'border-primary/60 bg-primary/5',
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-1">
        {isTrash ? (
          <Trash2 className="size-4 text-muted-foreground" />
        ) : (
          <ItemTypeIcon typeName={group} className="size-4" />
        )}
        <span className="text-sm font-semibold">{isTrash ? 'Trash' : getTypeLabel(group)}</span>
        <span className="ml-auto rounded-full bg-muted px-2 text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
        {isTrash && count > 0 && onEmptyTrash && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onEmptyTrash}>
            Empty
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

interface SortableCardProps {
  item: BrainDumpDraftItem
  index: number
  group: Group
  jobId: string
  onPatchPending: (delta: number) => void
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
  onRemoved: () => void
}

function SortableCard({ item, index, group, jobId, onPatchPending, onEdited, onRemoved }: SortableCardProps) {
  const { ref, handleRef, isDragging } = useSortable({
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
      rootRef={ref}
      handleRef={handleRef}
      isDragging={isDragging}
      onPatchPending={onPatchPending}
      onEdited={onEdited}
      onRemoved={onRemoved}
    />
  )
}
