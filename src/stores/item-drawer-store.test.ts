import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useItemDrawerStore } from './item-drawer-store'
import type { LightItem, FullItem } from '@/types/item'

const ITEM: LightItem = {
  id: 'item-1',
  title: 'Test item',
  createdAt: '2024-01-01T00:00:00.000Z',
  itemType: { name: 'snippet' },
  descriptionPreview: null,
  contentPreview: null,
  url: null,
  tags: [],
  fileName: null,
  fileSize: null,
  isFavorite: false,
  isPinned: false,
}

const FULL_ITEM: FullItem = {
  ...ITEM,
  description: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
  collections: [],
  content: null,
  language: null,
}

function resetStore() {
  useItemDrawerStore.setState({
    isOpen: false,
    selectedItemId: null,
    item: null,
    openScrollY: 0,
  })
}

describe('useItemDrawerStore.openDrawer', () => {
  beforeEach(resetStore)
  afterEach(() => {
    // Remove any window stub a test installed so it does not leak into the node-env SSR case.
    delete (globalThis as { window?: unknown }).window
  })

  it('captures the current window scroll position into openScrollY', () => {
    // The test environment is `node` (no window), so stub the minimal shape openDrawer reads.
    ;(globalThis as { window?: { scrollY: number } }).window = { scrollY: 420 }

    useItemDrawerStore.getState().openDrawer(ITEM)

    const state = useItemDrawerStore.getState()
    expect(state.openScrollY).toBe(420)
    expect(state.isOpen).toBe(true)
    expect(state.selectedItemId).toBe('item-1')
    expect(state.item).toBe(ITEM)
  })

  it('falls back to 0 under SSR when window is undefined', () => {
    expect(typeof window).toBe('undefined')

    useItemDrawerStore.getState().openDrawer(ITEM)

    expect(useItemDrawerStore.getState().openScrollY).toBe(0)
  })

  it('overwrites openScrollY with the current scroll on every open', () => {
    // The slider's close-time restore relies on openScrollY being RE-captured on each open, not just the
    // first. Open at one position, then again at another, and assert the latest position wins.
    const win = { scrollY: 100 } as { scrollY: number }
    ;(globalThis as { window?: { scrollY: number } }).window = win

    useItemDrawerStore.getState().openDrawer(ITEM)
    expect(useItemDrawerStore.getState().openScrollY).toBe(100)

    win.scrollY = 500
    useItemDrawerStore.getState().openDrawer(ITEM)
    expect(useItemDrawerStore.getState().openScrollY).toBe(500)
  })
})

describe('useItemDrawerStore.setItem', () => {
  beforeEach(resetStore)
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('updates item without touching isOpen, selectedItemId, or openScrollY', () => {
    useItemDrawerStore.setState({
      isOpen: true,
      selectedItemId: 'item-1',
      item: FULL_ITEM,
      openScrollY: 200,
    })

    const updated: FullItem = { ...FULL_ITEM }
    useItemDrawerStore.getState().setItem(updated)

    const state = useItemDrawerStore.getState()
    expect(state.item).toBe(updated)
    expect(state.isOpen).toBe(true)
    expect(state.selectedItemId).toBe('item-1')
    expect(state.openScrollY).toBe(200)
  })
})

describe('useItemDrawerStore.closeDrawer', () => {
  beforeEach(resetStore)

  it('clears the open state without resetting openScrollY (read-on-close, overwritten next open)', () => {
    useItemDrawerStore.setState({
      isOpen: true,
      selectedItemId: 'item-1',
      item: ITEM,
      openScrollY: 300,
    })

    useItemDrawerStore.getState().closeDrawer()

    const state = useItemDrawerStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.selectedItemId).toBeNull()
    expect(state.item).toBeNull()
    // openScrollY is intentionally not reset — the slider reads it during the close animation.
    expect(state.openScrollY).toBe(300)
  })

  it('is idempotent when called on an already-closed drawer', () => {
    // Calling closeDrawer when already closed must not throw or corrupt state.
    useItemDrawerStore.getState().closeDrawer()

    const state = useItemDrawerStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.selectedItemId).toBeNull()
    expect(state.item).toBeNull()
  })
})

describe('useItemDrawerStore — open → close → reopen scroll restore', () => {
  beforeEach(resetStore)
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('overwrites openScrollY with the new position after a close–reopen cycle', () => {
    const win = { scrollY: 100 } as { scrollY: number }
    ;(globalThis as { window?: { scrollY: number } }).window = win

    useItemDrawerStore.getState().openDrawer(ITEM)
    expect(useItemDrawerStore.getState().openScrollY).toBe(100)

    useItemDrawerStore.getState().closeDrawer()
    // openScrollY is retained during close — the slider reads it while the close animation plays.
    expect(useItemDrawerStore.getState().openScrollY).toBe(100)

    win.scrollY = 250
    useItemDrawerStore.getState().openDrawer(ITEM)
    // Must be overwritten with the new position, not stuck at the previous open's value.
    expect(useItemDrawerStore.getState().openScrollY).toBe(250)
  })
})

describe('useItemDrawerStore.openDrawer — edge cases', () => {
  beforeEach(resetStore)
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('captures openScrollY = 0 when window.scrollY is 0 (no phantom scroll on restore)', () => {
    // The slider's close-time restore must not scroll at all when openScrollY is 0.
    ;(globalThis as { window?: { scrollY: number } }).window = { scrollY: 0 }

    useItemDrawerStore.getState().openDrawer(ITEM)

    expect(useItemDrawerStore.getState().openScrollY).toBe(0)
  })
})
