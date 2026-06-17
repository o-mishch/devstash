'use client'

import { useRef, type TouchEvent } from 'react'

interface SelectTouchSwipeHandlers {
  onTouchStart: (e: TouchEvent) => void
  onTouchMove: (e: TouchEvent) => void
  onTouchEnd: (e: TouchEvent) => void
}

// Past this much finger travel the gesture counts as a drag (native-picker scrub) rather than a
// plain tap, so we take over selection instead of leaving it to base-ui's click handling.
const DRAG_THRESHOLD_PX = 6

// Native-picker-style touch interaction for a Select listbox: press and drag a finger across the
// options to highlight whichever sits under it, lift to select it. base-ui only does its
// overlap-align picker behaviour for mouse input (alignItemWithTrigger is mouse-only and is
// disabled whenever a touch pointer opens the popup), so on touch the list is otherwise tap-only.
// Spread the returned handlers onto the Select popup/list.
//
// A plain tap is left untouched — base-ui's own click handling selects it. We only take over once
// the finger has actually moved (a drag); on lift we select the highlighted option and call
// preventDefault to swallow the trailing compatibility mouse click, so selection fires exactly once
// and the synthesized click can't land on the trigger after the popup closes.
export function useSelectTouchSwipe(): SelectTouchSwipeHandlers {
  const activeRef = useRef<HTMLElement | null>(null)
  const draggedRef = useRef(false)
  const startXRef = useRef(0)
  const startYRef = useRef(0)

  function setActive(el: HTMLElement | null) {
    if (activeRef.current === el) return
    // The options are rendered by base-ui, so there is no React handle to them and no React way to
    // ask "what is under this finger". elementFromPoint + a data attribute the item styles is the
    // only way to drive the transient highlight without forking the primitive.
    activeRef.current?.removeAttribute('data-touch-active')
    el?.setAttribute('data-touch-active', '')
    activeRef.current = el
  }

  function optionAt(x: number, y: number): HTMLElement | null {
    const node = document.elementFromPoint(x, y)
    const option = node?.closest('[role="option"]')
    if (!(option instanceof HTMLElement)) return null
    if (option.getAttribute('aria-disabled') === 'true') return null
    return option
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    startXRef.current = touch.clientX
    startYRef.current = touch.clientY
    draggedRef.current = false
    setActive(optionAt(touch.clientX, touch.clientY))
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    const movedFar =
      Math.abs(touch.clientX - startXRef.current) > DRAG_THRESHOLD_PX ||
      Math.abs(touch.clientY - startYRef.current) > DRAG_THRESHOLD_PX
    if (movedFar) draggedRef.current = true
    setActive(optionAt(touch.clientX, touch.clientY))
  }

  function onTouchEnd(e: TouchEvent) {
    const el = activeRef.current
    setActive(null)
    if (!draggedRef.current) return
    e.preventDefault()
    el?.click()
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
