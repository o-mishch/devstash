'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, Check, Loader2, Undo2, CopyCheck, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  usePatchBrainDumpDraftItem,
  useDeleteBrainDumpDraftItem,
  useCommitBrainDumpDraftItem,
  type BrainDumpDraftItem,
  type BrainDumpCommitResult,
} from '@/hooks/items/use-brain-dump'
import { useItemUrlParamSync } from '@/hooks/items/use-item-url-param-sync'
import { useFetchItemDetail } from '@/hooks/items/use-item-detail'
import { useItemDrawerStore } from '@/stores/item-drawer-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn, actionbarLabelClass, ACTIONBAR_BUTTON_CLASS } from '@/lib/utils'
import { SYSTEM_TYPE_COLORS } from '@/lib/utils/constants'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SheetTitle } from '@/components/ui/sheet'
import { DrawerShell } from '@/components/items/drawer/drawer-shell'
import { ItemDrawerEditContent } from '@/components/items/drawer/item-drawer-edit-content'
import { MobileItemPaneSlider } from '@/components/items/drawer/mobile-item-pane-slider'
import { SWIPE_GRIP_PILL_CLASS, GRIP_VARIANTS } from '@/components/items/drawer/drawer-shared'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { useEditorFullscreenStore } from '@/stores/editor-fullscreen'
import { useMotionSwipeClose } from '@/hooks/ui/use-motion-swipe-close'
import { draftToFullItem } from '@/lib/utils/brain-dump-draft'
import type { CollectionPickerItem } from '@/types/collection'
import type { UpdateItemInput } from '@/lib/utils/validators'

interface ParseDraftCardProps {
  jobId: string
  item: BrainDumpDraftItem
  inTrash: boolean
  // History (closed-job) mode renders only the Trash bucket, so a restored draft would land in a type
  // bucket that isn't drawn and vanish from view. When false, the trash card drops Restore and offers
  // Edit / Save now / Delete forever instead, keeping every action reachable.
  canRestore: boolean
  // When true, scroll this card into view on mount and flash a highlight ring (deep-link target).
  highlight?: boolean
  // When true, this draft's last bulk-commit attempt failed — flash a transient error ring so it's
  // distinguishable from untouched cards. Cleared (via onClearFailed) on this card's next success.
  failed?: boolean
  // Clear this card's failed-ring — called after a successful trash/restore/commit/edit on this card.
  onClearFailed?: () => void
  // The job's "Save items to collection" target — shown read-only in the edit drawer so the user sees
  // where this draft will be saved. Empty hides the field (e.g. closed-job History mode).
  targetCollections?: CollectionPickerItem[]
  rootRef: (element: Element | null) => void
  isDragging: boolean
  // Optimistic trash/restore handlers from the board (reuse its `persistMove` — optimistic reflow with
  // revert on failure), so the card's Delete/Restore behave exactly like a drag into/out of Trash.
  onTrash: (item: BrainDumpDraftItem) => void
  onRestore: (item: BrainDumpDraftItem) => void
  // Bumped (+1/-1) around trash-membership mutations so the board can block Empty Trash while one is
  // in flight (a restore the server hasn't committed must not be deleted by an empty-trash).
  onPatchPending: (delta: number) => void
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
  onRemoved: () => void
}

export function ParseDraftCard({
  jobId,
  item,
  inTrash,
  canRestore,
  highlight,
  failed,
  onClearFailed,
  targetCollections,
  rootRef,
  isDragging,
  onTrash,
  onRestore,
  onPatchPending,
  onEdited,
  onRemoved,
}: ParseDraftCardProps) {
  const router = useRouter()
  const patchDraft = usePatchBrainDumpDraftItem()
  const deleteDraft = useDeleteBrainDumpDraftItem()
  const commitDraft = useCommitBrainDumpDraftItem()
  const [editOpen, setEditOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [highlighted, setHighlighted] = useState(highlight ?? false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  // Suppresses the click that fires after a drag ends. dnd-kit sets `isDragging` false before the
  // pointer-up click event fires. We track when the card was actively dragging in a ref, then on
  // the isDragging false transition set wasDraggingRef so openEditor swallows the next click.
  const wasDraggingRef = useRef(false)
  const wasDraggingActiveRef = useRef(false)
  useEffect(() => {
    if (isDragging) {
      wasDraggingActiveRef.current = true
    } else if (wasDraggingActiveRef.current) {
      wasDraggingActiveRef.current = false
      wasDraggingRef.current = true
    }
  }, [isDragging])

  // Run the scroll-into-view + open + ring-flash once per activation of `highlight`. `highlight` is a
  // reactive prop that can flip true AFTER mount (the deep-link target arrives once the draft streams in),
  // so it must be in the deps — but the `hasRun` guard keeps it a one-shot so a later re-render doesn't
  // re-trigger the scroll/open.
  const highlightRanRef = useRef(false)
  useEffect(() => {
    if (!highlight || highlightRanRef.current) return
    const el = cardRef.current
    if (!el) return
    highlightRanRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Open the drawer SYNCHRONOUSLY (not via a deferred rAF). The board re-renders heavily right after
    // mount — the SSE stream seeds, syncColumns reflows, AnimatePresence/layoutId reconciles — and a
    // deferred open (requestAnimationFrame) scheduled here was cancelled by this effect's cleanup on that
    // churn before it could fire, so a `?item=` deep-link often never opened the drawer. Setting editOpen
    // directly commits the open with the same render; the Sheet still plays its enter animation via its
    // `data-starting-style` transform, so nothing is lost visually. The ring still flashes for 1.5s.
    setHighlighted(true)
    setEditOpen(true)
    const ringTimer = setTimeout(() => setHighlighted(false), 1500)
    return () => clearTimeout(ringTimer)
  }, [highlight])

  // Keep ?item=<draftId> in sync with the edit drawer via the shared hook (same mechanism the item
  // drawer provider uses), so a draft's editor is deep-linkable and clears the param on close.
  useItemUrlParamSync(editOpen, item.id)

  // Collection-confirm dialog: shown when "Save now" needs the user to confirm creating the job's pending
  // new collection before this draft can attach to it (the full-job "Save all" creates it silently).
  const [collectionConfirmOpen, setCollectionConfirmOpen] = useState(false)

  // Delete-forever confirm dialog: permanent removal from the Trash bucket is irreversible, so the
  // Delete icon opens this dialog instead of deleting immediately.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  // Soft delete / restore: delegate to the board's optimistic `persistMove`-backed handlers (optimistic
  // reflow + revert on failure + failed-ring clear), instead of the card's old pessimistic await-then-
  // apply spinner. These are synchronous — the card no longer blocks/spins on the network round-trip.
  const trash = () => onTrash(item)
  const restore = () => onRestore(item)

  // Permanent delete (from the Trash bucket only) — removes the row for good. Reached only via the
  // delete-confirm dialog (irreversible), so it closes that dialog as it runs.
  const deleteForever = async () => {
    setDeleteConfirmOpen(false)
    setBusy(true)
    onPatchPending(1)
    const ok = await deleteDraft(jobId, item.id)
    onPatchPending(-1)
    setBusy(false)
    if (!ok) {
      toast.error('Could not delete draft')
      return
    }
    onRemoved()
  }

  // Applies a settled per-item commit result: toasts, drops the card, and — when this was the last draft
  // (the job auto-closed) — redirects to the dashboard (always dashboard, matching "Save all").
  const applyCommitResult = (result: BrainDumpCommitResult): void => {
    if (!result.ok) {
      toast.error(result.message ?? 'Could not save item')
      return
    }
    // A successful action supersedes a prior bulk-commit failure on this card (it's leaving the board now).
    onClearFailed?.()
    toast.success(`Saved “${item.title}”`)
    onRemoved()
    if (result.closed) router.push('/dashboard')
  }

  // Per-item "Save now": commit this draft into a real item, attached to the job's collection target
  // (same as the batch "Save all"), then drop the draft. Spends no AI budget (just createItem). The first
  // attempt omits `confirmCreateCollection`; if the job has a pending new collection the server answers
  // `needsCollectionConfirm` and we open the confirm dialog instead of committing.
  const saveNow = async () => {
    setBusy(true)
    const result = await commitDraft(jobId, item.id)
    setBusy(false)
    if (result.needsCollectionConfirm) {
      setCollectionConfirmOpen(true)
      return
    }
    applyCommitResult(result)
  }

  // Re-commit after the collection-confirm dialog: `create` true materializes the pending new collection
  // and attaches it; false (Cancel) commits the item with no new collection. Either way the item is saved.
  const confirmSaveNow = async (create: boolean) => {
    setCollectionConfirmOpen(false)
    setBusy(true)
    const result = await commitDraft(jobId, item.id, { confirmCreateCollection: create })
    setBusy(false)
    applyCommitResult(result)
  }

  const subtitle = item.description || (item.itemTypeName === 'link' ? item.url : item.content)

  // The whole card is the drag source (no separate grip handle): press+move drags, a plain press opens
  // the editor. The board's PointerSensor activation distance (5px mouse / hold on touch) is what
  // separates the two, so a click that doesn't move never starts a drag. The action buttons
  // opt out of both via `data-no-drag` (the sensor's preventActivation) and stopPropagation (so they
  // don't open the drawer). `wasDraggingRef` suppresses the click that fires on pointer-up after a drag.
  const openEditor = () => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false
      return
    }
    if (!busy) setEditOpen(true)
  }

  return (
    // Local provider so the card's action/duplicate tooltips appear quickly (150ms) instead of the
    // app-wide 400ms default — matching the Brain Dump entry card.
    <TooltipProvider delay={150}>
      <div
        ref={(el) => {
          rootRef(el)
          cardRef.current = el as HTMLDivElement | null
        }}
        role="button"
        tabIndex={0}
        onClick={openEditor}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openEditor()
          }
        }}
        aria-label={`Open ${item.title}`}
        // The accent feeds the colored left border (matching the app's item cards / unified card system):
        // a 2px left border that's neutral at rest and lights up to the item-type color on hover.
        style={{ '--card-accent': SYSTEM_TYPE_COLORS[item.itemTypeName] ?? 'var(--primary)' } as CSSProperties}
        // card-interactive = the same hover lift + highlight + shadow as the dashboard item rows.
        // draggable-card = touch-action:none so a press-and-hold drags on touch screens (the whole card
        // is the drag source) instead of the browser hijacking the gesture for scrolling.
        className={cn(
          // `relative` anchors the absolutely-positioned action overlay below. The overlay (not an inline
          // flex sibling) means the text column owns the FULL row width — title/subtitle truncate against
          // the card edge, not against a permanently-reserved icon column — so a non-hovered card shows
          // maximally more of the title. The 2px left border picks up the type accent on hover
          // (`hover:border-l-[var(--card-accent)]`), mirroring the app's item cards.
          'card-interactive draggable-card group app-row relative gap-2.5 rounded-lg border border-border border-l-2 bg-card px-2.5 py-2 text-left transition-all hover:border-l-[var(--card-accent)]',
          isDragging && 'opacity-50',
          highlighted && 'ring-2 ring-primary ring-offset-1',
          // A failed bulk-commit left this card behind — flash an error ring so it stands out from
          // untouched cards. The highlight ring (deep-link) takes precedence when both are set.
          failed && !highlighted && 'ring-2 ring-destructive ring-offset-1',
        )}
      >
        <ItemTypeIcon typeName={item.itemTypeName} className="size-4 shrink-0" />
        {/* Title owns the whole first row (no badge sibling stealing width → truncates much later). The
          duplicate marker drops to the subtitle line as a compact icon-chip, where it competes with the
          lower-priority preview text instead of the title. `pr-14` reserves a gutter on hover so the
          revealed action overlay never sits over the last characters of a long title/subtitle. */}
        <div className="min-w-0 flex-1 group-hover:pr-14 group-focus-within:pr-14 touch:pr-14">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <div className="flex min-w-0 items-center gap-1.5">
            {!inTrash && item.duplicateOf && <DuplicateBadge match={item.duplicateOf} />}
            {subtitle && <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        <div
          data-no-drag
          onClick={(event) => event.stopPropagation()}
          // Absolute overlay pinned to the right edge so it reserves NO row width (per Tailwind's
          // hover-action pattern) — the text column truncates against the card edge, not this column.
          // Hover-reveal on desktop; always visible on touch/mobile (no hover there) via the `touch:`
          // variant (coarse pointer OR < lg viewport) so the actions are reachable without a hover.
          // A faint card-colored backdrop keeps the icons legible where they overlap text on a long row.
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0 rounded-md bg-card/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100"
        >
          {inTrash ? (
            <>
              {canRestore ? (
                <IconAction label="Restore" onClick={restore} disabled={busy}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                </IconAction>
              ) : (
                <>
                  <IconAction label="Edit" onClick={openEditor} disabled={busy}>
                    <Pencil className="size-3.5" />
                  </IconAction>
                  <IconAction
                    label="Save now"
                    tooltip="Commit this draft to your stash — moves it out of this Brain Dump and into your real items"
                    onClick={saveNow}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </IconAction>
                </>
              )}
              <IconAction label="Delete forever" onClick={() => setDeleteConfirmOpen(true)} disabled={busy} destructive>
                <Trash2 className="size-3.5" />
              </IconAction>
            </>
          ) : (
            <>
              <IconAction label="Delete" tooltip="Delete (move to trash)" onClick={trash} disabled={busy} destructive>
                <Trash2 className="size-3.5" />
              </IconAction>
              <IconAction
                label="Save now"
                tooltip="Commit this draft to your stash — moves it out of this Brain Dump and into your real items"
                onClick={saveNow}
                disabled={busy}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              </IconAction>
            </>
          )}
        </div>

        <EditDraftDrawer
          open={editOpen}
          onOpenChange={setEditOpen}
          jobId={jobId}
          item={item}
          patchDraft={patchDraft}
          targetCollections={targetCollections}
          onEdited={(patch) => {
            // A successful draft edit also clears a prior bulk-commit failure ring on this card.
            onClearFailed?.()
            onEdited(patch)
          }}
          busy={busy}
          canCommit={!inTrash || !canRestore}
          inTrash={inTrash}
          onTrash={() => {
            trash()
            setEditOpen(false)
          }}
          onRestore={() => {
            restore()
            setEditOpen(false)
          }}
          onDeleteForever={() => setDeleteConfirmOpen(true)}
          onCommit={async () => {
            await saveNow()
            // saveNow drops the card on success (onRemoved) and may open the collection-confirm dialog;
            // close the drawer either way so the confirm dialog (rendered on the card) isn't behind it.
            setEditOpen(false)
          }}
        />
        {/* Both confirm dialogs portal to <body> in the DOM, but in the REACT tree they sit under the card's
            clickable root (onClick={openEditor}), and React bubbles synthetic clicks along the REACT tree —
            so clicking any dialog button (notably Cancel, which leaves the card mounted) would bubble up and
            open the draft editor. Stop propagation here so dialog clicks never reach openEditor. (The
            EditDraftDrawer above already does this via DrawerShell's stopPropagation prop.) */}
        <div onClick={(event) => event.stopPropagation()}>
          <Dialog open={collectionConfirmOpen} onOpenChange={setCollectionConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create the collection for this item?</DialogTitle>
                <DialogDescription>
                  This Brain Dump wants to save items into a new collection. Saving this item now will create
                  that collection. You can save it without the collection instead.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => confirmSaveNow(false)} disabled={busy}>
                  Save without collection
                </Button>
                <Button size="sm" onClick={() => confirmSaveNow(true)} disabled={busy}>
                  Create and save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <DialogContent elevated>
              <DialogHeader>
                <DialogTitle>Delete this draft permanently?</DialogTitle>
                <DialogDescription>
                  “{item.title}” will be removed from this Brain Dump for good. This can’t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={deleteForever} disabled={busy}>
                  Delete forever
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface IconActionProps {
  label: string
  // Optional richer tooltip text; falls back to `label`. Used to share the drawer's verbose action copy
  // (e.g. the full Commit explanation) while keeping `aria-label` short.
  tooltip?: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: ReactNode
}

// A compact icon-only card action with a shadcn tooltip (the card is dense, so the actions are
// icon-only). Used for Edit / Save now / Delete / Restore on the draft card.
function IconAction({ label, tooltip, onClick, disabled, destructive, children }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            // `icon-sm` carries `touch:size-11` (44px tap target on coarse-pointer / <lg). On this dense
            // overlay the cards are already tap-friendly, so neutralize it (`touch:size-6`) — otherwise
            // the buttons balloon and the trash/check icons drift far apart on touch/narrow viewports.
            className={cn('size-6 touch:size-6', destructive && 'text-destructive hover:text-destructive')}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent className="max-w-[260px]">{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

interface DrawerActionProps {
  icon: ReactNode
  // Visible button text (also the default aria-label / tooltip).
  label: string
  // Overrides aria-label when it must differ from the visible text (e.g. "Delete forever" vs "Delete").
  ariaLabel?: string
  // Tooltip copy; falls back to label.
  tooltip?: string
  // Collapse-priority for the label span (see actionbarLabelClass) — higher = collapses later.
  labelPriority?: number
  onClick: () => void
  disabled?: boolean
  // Red destructive styling (Delete actions).
  destructive?: boolean
  // Filled primary button instead of outline (the Commit action).
  primary?: boolean
}

// A worded action-bar button (icon + collapsing label + tooltip) for the draft edit drawer's footer —
// the verbose sibling of IconAction. Used for Restore / Delete / Delete-forever / Commit.
function DrawerAction({ icon, label, ariaLabel, tooltip, labelPriority = 2, onClick, disabled, destructive, primary }: DrawerActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={primary ? 'default' : 'outline'}
            size="sm"
            className={cn(ACTIONBAR_BUTTON_CLASS, destructive && 'text-destructive hover:text-destructive')}
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel ?? label}
          >
            {icon}
            <span className={actionbarLabelClass(labelPriority)}>{label}</span>
          </Button>
        }
      />
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

type DuplicateOf = NonNullable<BrainDumpDraftItem['duplicateOf']>

interface DuplicateBadgeProps {
  match: DuplicateOf
}

// Advisory "possible duplicate" badge — opens the existing item's detail drawer IN PLACE on the current
// page (fetch by id → openDrawer), so closing the drawer returns the user to the parse board instead of
// navigating away to /items/<type>. The drawer + provider live in the shared (app) layout, so they're
// already mounted here. Never blocks commit; purely informational.
function DuplicateBadge({ match }: DuplicateBadgeProps) {
  const fetchItemDetail = useFetchItemDetail()
  const openDrawer = useItemDrawerStore((state) => state.openDrawer)
  const [opening, setOpening] = useState(false)

  // Compact icon-only chip (down from the worded "Possible duplicate" badge): on the subtitle line it
  // must not steal width from the preview text. The full meaning + "click to open" lives in the tooltip
  // below; `aria-label` keeps it accessible to screen readers despite the absent visible text.
  const badge = (
    <Badge
      variant="outline"
      aria-label="Possible duplicate"
      className="shrink-0 gap-1 border-amber-500/40 px-1 py-0 text-[10px] font-normal text-amber-600 dark:text-amber-400"
    >
      <CopyCheck className="size-3" />
      Dup
    </Badge>
  )

  // Fetch the referenced item by id and pop the shared item drawer — same fetch-then-openDrawer path as
  // ItemDeepLink, but triggered by a click rather than a URL param, so the user never leaves /parse.
  // The badge sits inside the card's `role="button"` (onClick → openEditor) on the drag source, so stop
  // the click from bubbling (else it opens THIS draft's editor) and mark `data-no-drag` (else a press
  // starts a card drag).
  const openReferenced = async (event: MouseEvent) => {
    event.stopPropagation()
    if (opening) return
    setOpening(true)
    // Cached fetch (TanStack) — re-opening the same referenced item skips the backend round-trip.
    const item = await fetchItemDetail(match.id)
    setOpening(false)
    if (item) {
      openDrawer(item)
    } else {
      toast.error('That item is no longer available.')
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-no-drag
            onClick={openReferenced}
            disabled={opening}
            className="inline-flex w-fit underline-offset-2 hover:underline disabled:opacity-70"
          />
        }
      >
        {badge}
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        {`Looks like “${match.title}”, already in your stash. Click to open it.`}
      </TooltipContent>
    </Tooltip>
  )
}

interface EditDraftDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  item: BrainDumpDraftItem
  patchDraft: ReturnType<typeof usePatchBrainDumpDraftItem>
  onEdited: (patch: Partial<BrainDumpDraftItem>) => void
  // Mirrors the card's busy state so the drawer's Delete/Commit lock during a card-level action.
  busy: boolean
  // The job's "Save items to collection" target — shown read-only so the user sees where this draft will
  // be saved (drafts have no per-item collections; they attach to the job target on commit).
  targetCollections?: CollectionPickerItem[]
  // Commit (→ live item) is offered for live drafts and for closed-job trash drafts (still committable),
  // but not for a restorable trash draft (the user restores it first via the card).
  canCommit: boolean
  // True when the item is already in the Trash bucket — swaps the Delete action for Restore.
  inTrash: boolean
  // Move the draft to the Trash bucket (soft delete), then close the drawer.
  onTrash: () => void
  // Restore the draft from the Trash bucket back to the active board, then close the drawer.
  onRestore: () => void
  // Open the permanent-delete confirmation dialog (trash items only).
  onDeleteForever: () => void
  // Commit the draft into a real item (reuses the card's per-item Save-now flow incl. collection-confirm
  // + last-draft redirect), then close the drawer.
  onCommit: () => void
}

interface MobileDraftFullScreenViewProps {
  item: BrainDumpDraftItem | null
  open: boolean
  targetCollections?: CollectionPickerItem[]
  onSave: (payload: UpdateItemInput) => Promise<void>
  onOpenChange: (open: boolean) => void
  isSettled: boolean
  onSwipeCloseStart?: () => void
  busy: boolean
  canCommit: boolean
  inTrash: boolean
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
  onCommit: () => void
}

// Full-screen mobile view for the draft edit drawer. Mirrors ItemFullScreenView: renders as document-flow
// content (no Sheet) so the page scrolls and the browser URL bar can retract. Swipe-right closes via
// Motion's drag gesture — same thresholds and fly-off as ItemFullScreenView.
function MobileDraftFullScreenView({
  item,
  open,
  targetCollections,
  onSave,
  onOpenChange,
  isSettled,
  onSwipeCloseStart,
  busy,
  canCommit,
  inTrash,
  onTrash,
  onRestore,
  onDeleteForever,
  onCommit,
}: MobileDraftFullScreenViewProps) {
  const editorFullscreen = useEditorFullscreenStore((s) => s.fullscreen)
  const sheetCloseRef = useRef<(() => void) | null>(null)

  const requestClose = () => {
    const guardedClose = sheetCloseRef.current
    if (guardedClose) guardedClose()
    else onOpenChange(false)
  }

  const { x, panelRef, gripPressed, setGripPressed, dragEnabled, handleDrag, handleDragEnd } = useMotionSwipeClose({
    isOpen: open,
    isSettled,
    editorFullscreen,
    onSwipeCloseStart,
    requestClose,
  })

  // Reset scroll and drag offset when item changes while settled.
  const itemId = item?.id ?? null
  useLayoutEffect(() => {
    if (itemId === null || !isSettled) return
    // document required: in settled mode the draft pane IS the page document.
    const scroller = document.scrollingElement ?? document.documentElement
    scroller.scrollTop = 0
    // x is a stable useMotionValue ref — intentionally excluded from deps.
    x.set(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, isSettled])

  if (!item) return null
  return (
    <motion.div
      ref={panelRef}
      drag={dragEnabled ? 'x' : false}
      dragDirectionLock
      whileDrag="dragging"
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      style={{ x }}
      className="app-dot-grid relative min-h-[100lvh] touch-pan-y bg-background shadow-[-8px_0_24px_rgba(0,0,0,0.25)]"
    >
      {!editorFullscreen ? (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[55] w-2">
          <div className="sticky top-0 flex h-[100lvh] flex-col items-start justify-center pl-1">
            <motion.div
              className={cn(SWIPE_GRIP_PILL_CLASS, 'pointer-events-auto touch-none')}
              variants={GRIP_VARIANTS}
              initial="idle"
              animate={gripPressed ? 'dragging' : 'idle'}
              onPointerDown={() => setGripPressed(true)}
              onPointerUp={() => setGripPressed(false)}
              onPointerCancel={() => setGripPressed(false)}
              onPointerLeave={() => setGripPressed(false)}
            />
          </div>
        </div>
      ) : null}
      <h1 className="sr-only">Edit draft</h1>
      <ItemDrawerEditContent
        key={item.id}
        item={draftToFullItem(item)}
        collections={targetCollections ?? []}
        collectionsReadOnly
        fullScreen
        onClose={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        onSave={() => onOpenChange(false)}
        onSubmitOverride={onSave}
        showDetailsSection={false}
        sheetCloseRef={sheetCloseRef}
        saveLabel="Save draft"
        saveTooltip="Save your edits to this draft (stays in review)"
        renderExtraActions={({ disabled }) => (
          <>
            {inTrash ? (
              <>
                <DrawerAction
                  icon={<Undo2 className="size-4" />}
                  label="Restore"
                  labelPriority={2}
                  tooltip="Restore draft from trash"
                  onClick={onRestore}
                  disabled={disabled || busy}
                />
                <DrawerAction
                  icon={<Trash2 className="size-4" />}
                  label="Delete"
                  ariaLabel="Delete forever"
                  labelPriority={3}
                  tooltip="Delete permanently"
                  onClick={onDeleteForever}
                  disabled={disabled || busy}
                  destructive
                />
              </>
            ) : (
              <DrawerAction
                icon={<Trash2 className="size-4" />}
                label="Delete"
                labelPriority={3}
                tooltip="Delete (move to trash)"
                onClick={onTrash}
                disabled={disabled || busy}
                destructive
              />
            )}
            {canCommit && (
              <DrawerAction
                icon={<PackageCheck className="size-4" />}
                label="Commit"
                labelPriority={4}
                tooltip="Commit this draft to your stash"
                onClick={onCommit}
                disabled={disabled || busy}
                primary
              />
            )}
          </>
        )}
      />
    </motion.div>
  )
}

// The draft edit drawer reuses the app's real item-edit drawer content (DRY + consistency): same title
// editor, type-switcher, language picker, Monaco content editor, AI description/tags. Save is routed to
// the draft PATCH endpoint via `onSubmitOverride` instead of the real-item update flow. Drafts have no
// per-item collections — they attach to the job's collection target on commit — so the field shows that
// shared target read-only (collectionsReadOnly) rather than an editable picker.
//
// On touch/mobile: renders via MobileItemPaneSlider + MobileDraftFullScreenView (document-flow content,
// no Sheet) so the browser URL bar can retract on scroll and swiping down feels native — matching the
// behaviour of the main dashboard item drawer. On desktop: the existing DrawerShell (right-side Sheet).
function EditDraftDrawer({ open, onOpenChange, jobId, item, patchDraft, targetCollections, onEdited, busy, canCommit, inTrash, onTrash, onRestore, onDeleteForever, onCommit }: EditDraftDrawerProps) {
  const isTouch = useIsTouch()

  const saveDraft = async (payload: UpdateItemInput): Promise<void> => {
    const patch: Partial<BrainDumpDraftItem> = {
      title: payload.title,
      description: payload.description ?? null,
      content: payload.content ?? null,
      url: payload.url ?? null,
      language: payload.language ?? null,
      tags: payload.tags ?? [],
      // A staged type switch in the drawer re-types the draft (and re-buckets it on the board).
      ...(payload.itemTypeName ? { itemTypeName: payload.itemTypeName } : {}),
    }
    const result = await patchDraft(jobId, item.id, patch)
    if (!result.ok) {
      toast.error('Could not save changes')
      return
    }
    onEdited(result.item ?? patch)
    toast.success('Draft saved')
    onOpenChange(false)
  }

  // Latch the item so the closing slide keeps rendering it after the parent clears it.
  const [paneItem, setPaneItem] = useState<BrainDumpDraftItem | null>(item)
  if (open && item.id !== paneItem?.id) setPaneItem(item)

  const sharedProps = { busy, canCommit, inTrash, onTrash, onRestore, onDeleteForever, onCommit }

  if (isTouch) {
    // Mobile: full-screen document-flow content so URL bar retracts and swipe-down feels native.
    // The brain dump board page is the `page` backdrop; the draft slides in over it.
    // `stopPropagation` is not needed here — the slider renders outside the card's React subtree.
    return (
      <MobileItemPaneSlider
        page={null}
        open={open}
        openScrollY={0}
        renderPane={({ isSettled, onSwipeCloseStart }) => (
          <MobileDraftFullScreenView
            item={paneItem}
            open={open}
            targetCollections={targetCollections}
            onSave={saveDraft}
            onOpenChange={onOpenChange}
            isSettled={isSettled}
            onSwipeCloseStart={onSwipeCloseStart}
            {...sharedProps}
          />
        )}
      />
    )
  }

  // Desktop: right-side Sheet shell (resize, swipe-to-dismiss, grab handle, close-ref plumbing).
  // `stopPropagation` is on because this Sheet sits under the draft card's clickable root in the React
  // tree — React bubbles synthetic events along the React tree, not the DOM tree, so a click inside
  // the drawer would otherwise bubble up to the card's onClick and reopen it.
  return (
    <DrawerShell open={open} onOpenChange={onOpenChange} stopPropagation>
      {(sheetCloseRef) => (
        <>
          <SheetTitle className="sr-only">Edit draft</SheetTitle>
          {/* Key on the draft id ONLY — keying on title/content would full-remount the form whenever a
           * stream re-emit updates this draft, silently dropping the user's in-progress edits (and
           * bypassing the dirty guard). ItemDrawerEditContent snapshots `item` into the form on mount and
           * does NOT reconcile later field changes (there is no reconciliation effect) — the id `key` is
           * the only remount seam, so an open edit is never overwritten by a background re-emit. */}
          <ItemDrawerEditContent
            key={item.id}
            item={draftToFullItem(item)}
            collections={targetCollections ?? []}
            collectionsReadOnly
            onClose={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
            onSave={() => onOpenChange(false)}
            onSubmitOverride={saveDraft}
            showDetailsSection={false}
            sheetCloseRef={sheetCloseRef}
            saveLabel="Save draft"
            saveTooltip="Save your edits to this draft (stays in review)"
            renderExtraActions={({ disabled }) => (
              <>
                {inTrash ? (
                  <>
                    {/* Distinct ascending priorities so labels collapse one at a time from the right as the
                        bar narrows. Same priority on two siblings makes them collapse together, leaving the
                        rightmost (Delete) clipped before either label drops — the bug this avoids. */}
                    <DrawerAction
                      icon={<Undo2 className="size-4" />}
                      label="Restore"
                      labelPriority={2}
                      tooltip="Restore draft from trash"
                      onClick={onRestore}
                      disabled={disabled || busy}
                    />
                    <DrawerAction
                      icon={<Trash2 className="size-4" />}
                      label="Delete"
                      ariaLabel="Delete forever"
                      labelPriority={3}
                      tooltip="Delete permanently"
                      onClick={onDeleteForever}
                      disabled={disabled || busy}
                      destructive
                    />
                  </>
                ) : (
                  <DrawerAction
                    icon={<Trash2 className="size-4" />}
                    label="Delete"
                    labelPriority={3}
                    tooltip="Delete (move to trash)"
                    onClick={onTrash}
                    disabled={disabled || busy}
                    destructive
                  />
                )}
                {canCommit && (
                  <DrawerAction
                    icon={<PackageCheck className="size-4" />}
                    label="Commit"
                    labelPriority={4}
                    tooltip="Commit this draft to your stash — moves it out of this Brain Dump and into your real items"
                    onClick={onCommit}
                    disabled={disabled || busy}
                    primary
                  />
                )}
              </>
            )}
          />
        </>
      )}
    </DrawerShell>
  )
}
