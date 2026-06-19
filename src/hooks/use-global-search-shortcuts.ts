import { useEffect, type RefObject } from 'react'

interface UseGlobalSearchShortcutsParams {
  inputRef: RefObject<HTMLInputElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  setOpen: (open: boolean) => void
  closeDrawer: () => void
}

export function useGlobalSearchShortcuts({
  inputRef,
  containerRef,
  setOpen,
  closeDrawer,
}: UseGlobalSearchShortcutsParams) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
        closeDrawer()
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    // document.addEventListener is required for global key listening — React handlers attach to specific elements
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [closeDrawer, setOpen, inputRef])

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // document.addEventListener is required to detect clicks outside the container
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [setOpen, containerRef])
}
