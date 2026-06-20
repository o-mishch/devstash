'use client'

import { useCallback, useState, type PointerEvent } from 'react'

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

// Tracks whether a grab handle is actively pressed, and keeps it `true` for the WHOLE press — even
// as a swipe drags the finger off the small handle — by capturing the pointer on press. A plain
// `:active` style drops as soon as the browser starts the drag, so it can't stay highlighted the
// way this does. Purely visual: the swipe/dismiss gesture runs on touch events on the parent, which
// pointer capture does not affect, so spreading these handlers never changes the gesture itself.
export function usePressHighlight(): PressHighlight {
  const [pressed, setPressed] = useState(false)

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    // Best-effort: keeps pointer events flowing to the handle through the drag so `pressed` holds
    // even once the finger leaves the small target. An enhancement, not required for the highlight,
    // so a browser that rejects the capture (e.g. no active pointer) must not break the press.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture unavailable — the pressed state below still drives the highlight
    }
    setPressed(true)
  }, [])

  const release = useCallback(() => setPressed(false), [])

  // Fallback only for the rare press where setPointerCapture failed: without capture the handle won't
  // receive pointerup once the finger leaves the small target, so clear the highlight on leave instead.
  // While capture IS active the captured pointer keeps delivering up/cancel/lostpointercapture, so we
  // must NOT release on leave — holding the highlight through the drag is the whole point of capturing.
  const onPointerLeave = useCallback((e: PointerEvent<HTMLElement>) => {
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
