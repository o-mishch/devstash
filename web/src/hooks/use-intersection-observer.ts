import { useCallback, useEffect, useRef, useState } from 'react'

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  triggerOnce?: boolean
  /** Seed value before the observer's first callback fires (avoids a first-paint flash). */
  initialInView?: boolean
}

interface UseIntersectionObserverResult {
  ref: (node: HTMLElement | null) => void
  inView: boolean
}

export function useIntersectionObserver(
  options?: UseIntersectionObserverOptions,
): UseIntersectionObserverResult {
  const [inView, setInView] = useState(options?.initialInView ?? false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  // Track the latest options WITHOUT re-creating the `ref` callback — a fresh ref identity
  // makes React re-run it every render, tearing down and rebuilding the observer each time.
  // Written in an effect (not during render) so it doesn't trip the React Compiler's
  // no-ref-access-during-render rule; the useRef initializer seeds the correct first value.
  // Note: Options are evaluated once when the element is attached/observed; dynamic updates
  // to options after the observer is active are not supported (and not needed in this codebase).
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const ref = useCallback((node: HTMLElement | null): void => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!node) return

    const opts = optionsRef.current
    observerRef.current = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const isIntersecting = entry.isIntersecting

      // With triggerOnce, LATCH: once visible, stay visible and disconnect — never let a
      // later re-observe (e.g. the ref being reattached) flip `inView` back to false.
      if (opts?.triggerOnce === true) {
        if (isIntersecting) {
          setInView(true)
          observerRef.current?.disconnect()
        }
        return
      }

      setInView(isIntersecting)
    }, opts)

    observerRef.current.observe(node)
  }, [])

  useEffect((): (() => void) => () => observerRef.current?.disconnect(), [])

  return { ref, inView }
}
