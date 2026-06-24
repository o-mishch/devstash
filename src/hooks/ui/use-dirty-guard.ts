import { useState, useCallback, useRef, useLayoutEffect } from 'react'
import { useControllableOpen } from '@/hooks/ui/use-controllable-open'

interface UseDirtyGuardOptions {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  isDirty: boolean
}

interface UseDirtyGuardReturn {
  open: boolean
  handleOpenChange: (open: boolean, force?: boolean) => void
  confirmOpen: boolean
  handleConfirmOpenChange: (open: boolean) => void
  handleDiscard: () => void
}

/**
 * Wraps open/close state with a dirty-check guard. When the user attempts to
 * close and `isDirty` is true, the close is intercepted and a confirmation
 * dialog is shown instead. Pair with `<UnsavedChangesDialog>`.
 */
export function useDirtyGuard({
  open: controlledOpen,
  onOpenChange,
  onClose,
  isDirty,
}: UseDirtyGuardOptions): UseDirtyGuardReturn {
  const { open, handleOpenChange: setOpen } = useControllableOpen({
    open: controlledOpen,
    onOpenChange,
    onClose,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isDirtyRef = useRef(isDirty)
  // Track the latest dirty flag without re-creating handleOpenChange.
  useLayoutEffect(() => {
    isDirtyRef.current = isDirty
  })

  const handleOpenChange = useCallback(
    (isOpen: boolean, force?: boolean) => {
      // Closing path: intercept if dirty (unless forced)
      if (!isOpen && isDirtyRef.current && !force) {
        setConfirmOpen(true)
        return
      }
      setOpen(isOpen)
    },
    [setOpen],
  )

  const handleDiscard = useCallback(() => {
    setConfirmOpen(false)
    setOpen(false)
  }, [setOpen])

  return {
    open,
    handleOpenChange,
    confirmOpen,
    handleConfirmOpenChange: setConfirmOpen,
    handleDiscard,
  }
}
