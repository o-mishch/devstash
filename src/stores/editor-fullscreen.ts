import { create } from 'zustand'

interface EditorFullscreenStore {
  // Number of content editors (markdown / code) currently maximized to full screen, reference-counted
  // rather than a single boolean. A fullscreen editor covers the item drawer, so the drawer reads
  // `fullscreen` to disable swipe-to-dismiss (otherwise a swipe over the editor would close the whole
  // drawer). Counting — instead of last-writer-wins on a boolean — means that if two fullscreen-capable
  // editors are ever mounted, one collapsing or unmounting can't clear the flag while another is still
  // maximized. `fullscreen` is the derived `count > 0`. Driven by EditorChromeShell via enter/exit.
  count: number
  fullscreen: boolean
  enter: () => void
  exit: () => void
}

export const useEditorFullscreenStore = create<EditorFullscreenStore>((set) => ({
  count: 0,
  fullscreen: false,
  enter: () =>
    set((s) => {
      const count = s.count + 1
      return { count, fullscreen: count > 0 }
    }),
  exit: () =>
    set((s) => {
      const count = Math.max(0, s.count - 1)
      return { count, fullscreen: count > 0 }
    }),
}))
