import { useState, useCallback } from 'react'

interface UseControllableOpenOptions {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
}

export function useControllableOpen({ open: controlledOpen, onOpenChange, onClose }: UseControllableOpenOptions = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setInternalOpen(isOpen)
    onOpenChange?.(isOpen)
    if (!isOpen) onClose?.()
  }, [onOpenChange, onClose])

  return { open, handleOpenChange, setInternalOpen }
}
