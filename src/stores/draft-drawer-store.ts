import { create } from 'zustand'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { CollectionPickerItem } from '@/types/collection'
import type { UpdateItemInput } from '@/lib/utils/validators'

export interface DraftDrawerCallbacks {
  onSave: (payload: UpdateItemInput) => Promise<void>
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
  onCommit: () => void
}

interface DraftDrawerOpenOpts extends DraftDrawerCallbacks {
  targetCollections: CollectionPickerItem[] | undefined
  busy: boolean
  canCommit: boolean
  inTrash: boolean
}

interface DraftDrawerStore {
  open: boolean
  item: BrainDumpDraftItem | null
  targetCollections: CollectionPickerItem[] | undefined
  busy: boolean
  canCommit: boolean
  inTrash: boolean
  // Window scroll position captured synchronously at the open click (mirrors useItemDrawerStore). While the
  // mobile drawer is up the window is pinned to the top (the drawer is the document scroller), so the board's
  // scroll is lost from the browser — the slider restores this value on close. 0 on desktop (no slider reads it).
  // Set via setOpenScrollY from the card's click handler BEFORE openDrawer, so it captures the real position
  // before the open re-render pins the window; openDrawer preserves it.
  openScrollY: number
  callbacks: DraftDrawerCallbacks | null
  setOpenScrollY: (y: number) => void
  openDrawer: (item: BrainDumpDraftItem, opts: DraftDrawerOpenOpts) => void
  closeDrawer: () => void
}

export const useDraftDrawerStore = create<DraftDrawerStore>((set) => ({
  open: false,
  item: null,
  targetCollections: undefined,
  busy: false,
  canCommit: false,
  inTrash: false,
  openScrollY: 0,
  callbacks: null,

  setOpenScrollY: (y) => set({ openScrollY: y }),

  openDrawer: (item, opts) => set({
    open: true,
    item,
    targetCollections: opts.targetCollections,
    busy: opts.busy,
    canCommit: opts.canCommit,
    inTrash: opts.inTrash,
    // openScrollY is intentionally NOT set here — the card already captured it via setOpenScrollY at the
    // click (before this open re-render pinned the window to 0). Re-reading window.scrollY now would be 0.
    callbacks: {
      onSave: opts.onSave,
      onTrash: opts.onTrash,
      onRestore: opts.onRestore,
      onDeleteForever: opts.onDeleteForever,
      onCommit: opts.onCommit,
    },
  }),

  // Clear item + callbacks so the store never holds closures bound to a card that has unmounted
  // (board reflow, commit drops the card). The provider latches the last item for the close slide.
  closeDrawer: () => set({
    open: false,
    item: null,
    targetCollections: undefined,
    callbacks: null,
  }),
}))
