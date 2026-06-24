import { useLayoutEffect } from 'react'

/**
 * Ref the parent Sheet reads on Esc/backdrop/swipe so those close paths run through a
 * guard (dirty form / unsaved AI result) instead of closing directly.
 */
export type SheetCloseRef = { current: (() => void) | null }

/**
 * Registers `handler` into the parent Sheet's close ref and clears it on unmount, so
 * Esc/backdrop/swipe go through the same guard as the in-content close buttons. No-op
 * when no ref is provided. Re-runs every render so the handler closes over latest state.
 */
export function useRegisterSheetClose(sheetCloseRef: SheetCloseRef | undefined, handler: () => void) {
  useLayoutEffect(() => {
    if (!sheetCloseRef) return
    sheetCloseRef.current = handler
    return () => {
      sheetCloseRef.current = null
    }
  })
}
