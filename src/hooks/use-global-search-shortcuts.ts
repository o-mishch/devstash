import { useEffect, type RefObject } from 'react'

export function useGlobalSearchShortcuts({
  inputRef,
  containerRef,
  setOpen,
  closeDrawer,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  setOpen: (open: boolean) => void
  closeDrawer: () => void
}) {
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
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [closeDrawer, setOpen, inputRef])

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', click)
    return () => document.removeEventListener('mousedown', click)
  }, [setOpen, containerRef])
}
