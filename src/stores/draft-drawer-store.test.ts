import { describe, it, expect, beforeEach } from 'vitest'
import { useDraftDrawerStore } from './draft-drawer-store'
import type { BrainDumpDraftItem } from '@/hooks/items/use-brain-dump'
import type { CollectionPickerItem } from '@/types/collection'

const ITEM = { id: 'draft-1', title: 'Draft one' } as BrainDumpDraftItem
const OTHER_ITEM = { id: 'draft-2', title: 'Draft two' } as BrainDumpDraftItem
const COLLECTIONS: CollectionPickerItem[] = [{ id: 'col-1', name: 'Inbox' }]

function makeOpts(overrides: Partial<Parameters<ReturnType<typeof useDraftDrawerStore.getState>['openDrawer']>[1]> = {}) {
  return {
    targetCollections: COLLECTIONS,
    busy: false,
    canCommit: true,
    inTrash: false,
    onSave: async () => {},
    onTrash: () => {},
    onRestore: () => {},
    onDeleteForever: () => {},
    onCommit: () => {},
    ...overrides,
  }
}

function resetStore() {
  useDraftDrawerStore.setState({
    open: false,
    item: null,
    targetCollections: undefined,
    busy: false,
    canCommit: false,
    inTrash: false,
    openScrollY: 0,
    callbacks: null,
  })
}

describe('useDraftDrawerStore.openDrawer', () => {
  beforeEach(resetStore)

  it('seeds every field and packs the five callbacks', () => {
    const opts = makeOpts({ busy: true, inTrash: true, canCommit: false })
    useDraftDrawerStore.getState().openDrawer(ITEM, opts)

    const state = useDraftDrawerStore.getState()
    expect(state.open).toBe(true)
    expect(state.item).toBe(ITEM)
    expect(state.targetCollections).toBe(COLLECTIONS)
    expect(state.busy).toBe(true)
    expect(state.canCommit).toBe(false)
    expect(state.inTrash).toBe(true)
    expect(state.callbacks).toEqual({
      onSave: opts.onSave,
      onTrash: opts.onTrash,
      onRestore: opts.onRestore,
      onDeleteForever: opts.onDeleteForever,
      onCommit: opts.onCommit,
    })
  })

  it('preserves openScrollY set before openDrawer (captured at the click)', () => {
    useDraftDrawerStore.getState().setOpenScrollY(240)
    useDraftDrawerStore.getState().openDrawer(ITEM, makeOpts())
    // openDrawer must NOT reset openScrollY — the card captured it before the open pinned the window to 0.
    expect(useDraftDrawerStore.getState().openScrollY).toBe(240)
  })

  it('replaces the previous item and callbacks when a different draft opens', () => {
    useDraftDrawerStore.getState().openDrawer(ITEM, makeOpts())
    const next = makeOpts({ busy: true })
    useDraftDrawerStore.getState().openDrawer(OTHER_ITEM, next)

    const state = useDraftDrawerStore.getState()
    expect(state.item).toBe(OTHER_ITEM)
    expect(state.busy).toBe(true)
    expect(state.callbacks?.onSave).toBe(next.onSave)
  })
})

describe('useDraftDrawerStore.closeDrawer', () => {
  beforeEach(resetStore)

  it('clears item, callbacks, and targetCollections so no stale closure survives the close', () => {
    useDraftDrawerStore.getState().openDrawer(ITEM, makeOpts())
    useDraftDrawerStore.getState().closeDrawer()

    const state = useDraftDrawerStore.getState()
    expect(state.open).toBe(false)
    expect(state.item).toBeNull()
    expect(state.callbacks).toBeNull()
    expect(state.targetCollections).toBeUndefined()
  })

  it('is idempotent when called on an already-closed drawer', () => {
    useDraftDrawerStore.getState().closeDrawer()

    const state = useDraftDrawerStore.getState()
    expect(state.open).toBe(false)
    expect(state.item).toBeNull()
    expect(state.callbacks).toBeNull()
  })
})
