import { useCallback, useState } from 'react'
import type { PointerEvent } from 'react'

interface PressHighlightHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onLostPointerCapture: () => void
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void
}

interface PressHighlight {
  pressed: boolean
  handlers: PressHighlightHandlers
}

/**
 * Tracks whether a grab handle is actively pressed, and keeps it `true` for the WHOLE press — even
 * as a swipe drags the finger off the small handle — by capturing the pointer on press. A plain
 * `:active` style drops as soon as the browser starts the drag, so it can't stay highlighted this
 * way. Purely visual: the swipe gesture runs on touch events on the parent, which pointer capture
 * does not affect, so spreading these handlers never changes the gesture itself.
 */
export function usePressHighlight(): PressHighlight {
  const [pressed, setPressed] = useState(false)

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>): void => {
    // Best-effort: keeps pointer events flowing to the handle through the drag so `pressed` holds
    // even once the finger leaves the small target. An enhancement, not a requirement — a browser
    // that rejects the capture must not break the press.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture unavailable — the pressed state below still drives the highlight
    }
    setPressed(true)
  }, [])

  const release = useCallback((): void => {
    setPressed(false)
  }, [])

  // Fallback only for the rare press where setPointerCapture failed: without capture the handle
  // won't receive pointerup once the finger leaves the small target, so clear on leave instead.
  // While capture IS active the captured pointer keeps delivering up/cancel/lostpointercapture, so
  // we must NOT release on leave — holding the highlight through the drag is the point of capturing.
  const onPointerLeave = useCallback((e: PointerEvent<HTMLElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) setPressed(false)
  }, [])

  return {
    pressed,
    handlers: {
      onPointerDown,
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
      onPointerLeave,
    },
  }
}
