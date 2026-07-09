'use client'

import { useCallback, useEffect, useRef, type MouseEvent, type TouchEvent } from 'react'

interface UseEditorHeaderDragOptions {
  active: boolean
  // 'down' collapses fullscreen; 'up' expands from inline.
  direction: 'down' | 'up'
  thresholdPx: number
  flickVelocity: number
  onTrigger: () => void
  onClickWithoutDrag?: () => void
  // Live drag offset for visual feedback (collapse mode only).
  onDragOffset?: (px: number) => void
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return Boolean((target as HTMLElement | null)?.closest('button, [role="button"], a'))
}

/**
 * Touch + mouse drag on the editor chrome header. Collapse drags down with live offset; expand drags
 * up without visual offset. Only one mode is active at a time — refs are per hook instance.
 */
export function useEditorHeaderDrag({
  active,
  direction,
  thresholdPx,
  flickVelocity,
  onTrigger,
  onClickWithoutDrag,
  onDragOffset,
}: UseEditorHeaderDragOptions) {
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startTimeRef = useRef(0)
  const dragOffsetRef = useRef(0)
  const mouseDraggingRef = useRef(false)
  const hadMouseDragRef = useRef(false)
  const onTriggerRef = useRef(onTrigger)
  const onClickWithoutDragRef = useRef(onClickWithoutDrag)
  const onDragOffsetRef = useRef(onDragOffset)

  useEffect(() => {
    onTriggerRef.current = onTrigger
    onClickWithoutDragRef.current = onClickWithoutDrag
    onDragOffsetRef.current = onDragOffset
  })

  const resetDrag = useCallback(() => {
    dragOffsetRef.current = 0
    onDragOffsetRef.current?.(0)
  }, [])

  const applyDrag = useCallback(
    (clientY: number) => {
      const raw = clientY - startYRef.current
      const offset = direction === 'down' ? Math.max(0, raw) : raw
      dragOffsetRef.current = offset
      if (direction === 'down') onDragOffsetRef.current?.(offset)
    },
    [direction],
  )

  const shouldTrigger = useCallback(
    (dragged: number, elapsed: number) => {
      const velocity = Math.abs(dragged) / Math.max(1, elapsed)
      if (direction === 'down') {
        return dragged > thresholdPx || velocity > flickVelocity
      }
      return dragged < -thresholdPx || (dragged < 0 && velocity > flickVelocity)
    },
    [direction, thresholdPx, flickVelocity],
  )

  const finishDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const dragged = dragOffsetRef.current
    const elapsed = Math.max(1, Date.now() - startTimeRef.current)
    if (shouldTrigger(dragged, elapsed)) onTriggerRef.current()
    resetDrag()
  }

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    // Mirror the mouse guard: a tap on a header control (traffic-light dots, copy button) must not arm
    // the drag, or it jitters the fullscreen overlay / misfires the collapse threshold on touch.
    if (!active || isInteractiveTarget(e.target) || e.touches.length !== 1) return
    draggingRef.current = true
    startYRef.current = e.touches[0].clientY
    startTimeRef.current = Date.now()
  }

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (!active || !draggingRef.current || e.touches.length !== 1) return
    applyDrag(e.touches[0].clientY)
  }

  const onTouchEnd = () => finishDrag()

  const onTouchCancel = () => {
    draggingRef.current = false
    resetDrag()
  }

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || isInteractiveTarget(e.target)) return
    mouseDraggingRef.current = true
    hadMouseDragRef.current = false
    startYRef.current = e.clientY
    startTimeRef.current = Date.now()
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!active || isInteractiveTarget(e.target) || hadMouseDragRef.current) return
    onClickWithoutDragRef.current?.()
  }

  useEffect(() => {
    if (!active) return
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!mouseDraggingRef.current) return
      const raw = e.clientY - startYRef.current
      if (Math.abs(raw) > 5) hadMouseDragRef.current = true
      applyDrag(e.clientY)
    }
    const onMouseUp = () => {
      if (!mouseDraggingRef.current) return
      mouseDraggingRef.current = false
      const dragged = dragOffsetRef.current
      const elapsed = Math.max(1, Date.now() - startTimeRef.current)
      if (shouldTrigger(dragged, elapsed)) onTriggerRef.current()
      resetDrag()
    }
    // Bind listeners to document so the drag gesture continues tracking smoothly even if the mouse
    // drifts outside the header boundary (no framework equivalent exists).
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    // applyDrag/shouldTrigger are useCallback-memoized on direction/thresholdPx/flickVelocity, so
    // listing them re-attaches the listeners on exactly the same changes as before, via identity.
  }, [active, applyDrag, shouldTrigger, resetDrag])

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onMouseDown, onClick }
}
