import { create } from 'zustand'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { CollectionPickerItem } from '@/types/collection'
import type { UpdateItemInput } from '@/lib/utils/validators'

export interface DraftDrawerCallbacks {
  onSave: (payload: UpdateItemInput) => Promise<void>
  onOpenChange: (open: boolean) => void
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
  callbacks: DraftDrawerCallbacks | null
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
  callbacks: null,

  openDrawer: (item, opts) => set({
    open: true,
    item,
    targetCollections: opts.targetCollections,
    busy: opts.busy,
    canCommit: opts.canCommit,
    inTrash: opts.inTrash,
    callbacks: {
      onSave: opts.onSave,
      onOpenChange: opts.onOpenChange,
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
