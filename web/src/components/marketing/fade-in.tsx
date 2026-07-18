import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn, mergeRefs } from '@/lib/utils'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'

interface FadeInProps {
  children: ReactNode
  index?: number
  className?: string
}

// Module-level constant so the observer options keep a stable identity across renders —
// a fresh object literal each render would churn the observer inside the hook.
const OBSERVER_OPTIONS = {
  threshold: 0.1,
  rootMargin: '0px 0px -40px 0px',
  triggerOnce: true,
}

// `index % 6` makes the stagger a closed set, so these are static classes the JIT can scan
// rather than a computed inline style.
const DELAY_CLASSES = [
  'delay-0',
  'delay-[80ms]',
  'delay-[160ms]',
  'delay-[240ms]',
  'delay-[320ms]',
  'delay-[400ms]',
] as const

export function FadeIn({ children, index = 0, className }: FadeInProps): ReactNode {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const { ref: observerRef, inView } = useIntersectionObserver(OBSERVER_OPTIONS)
  // Stable across renders — a fresh ref callback each render would make React detach and
  // reattach the ref, tearing down and recreating the IntersectionObserver every render.
  // nodeRef and observerRef are both stable, so an empty dependency list is correct.
  const setRefs = useMemo(() => mergeRefs<HTMLDivElement>(nodeRef, observerRef), [observerRef])

  const [mounted, setMounted] = useState(false)
  const [alreadyVisible, setAlreadyVisible] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect((): (() => void) => {
    const el = nodeRef.current
    if (!el) return (): void => {}

    // `window.innerHeight`: read the viewport height to detect elements already in view
    // on first paint (before the IntersectionObserver fires) — no framework equivalent.
    const { top, bottom } = el.getBoundingClientRect()
    const visible = top < window.innerHeight && bottom >= 0

    setMounted(true)
    if (visible) {
      setAlreadyVisible(true)
    }
    // Arm transitions only AFTER the hidden state has painted, so `opacity-0` lands instantly
    // rather than over 700ms. There is no VISIBLE fade-out to prevent here: `opacity-0` only
    // applies while `!visible`, and the rect check above claims every element overlapping the
    // viewport, batched into this same render — so an on-screen element goes straight to
    // opacity-100 and only fully off-screen ones ever hide. What this buys is the narrow race
    // where the user flicks down to one of them within 700ms of hydration: unarmed, they catch
    // it mid-fade-out and watch it reverse from ~0.5 instead of fading in cleanly from 0.
    const frame = requestAnimationFrame((): void => setArmed(true))
    return (): void => cancelAnimationFrame(frame)
  }, [])

  const visible = alreadyVisible || inView

  return (
    <div
      ref={setRefs}
      className={cn(
        'transition-all duration-700',
        DELAY_CLASSES[index % 6],
        // Prerendered HTML carries no opacity class (both branches below are `mounted &&`), so
        // the element paints at opacity:1 for crawlers and no-JS readers. See the effect for
        // why the transition stays off until a frame after `opacity-0` first lands.
        !armed && 'transition-none',
        mounted && !visible && 'opacity-0 translate-y-4',
        mounted && visible && 'opacity-100 translate-y-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
