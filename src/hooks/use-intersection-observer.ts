import { useEffect, useRef, useState } from 'react'

interface UseIntersectionObserverResult {
  ref: (node: HTMLElement | null) => void
  inView: boolean
}

export function useIntersectionObserver(options?: IntersectionObserverInit): UseIntersectionObserverResult {
  const [inView, setInView] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const ref = (node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!node) return

    observerRef.current = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting)
    }, options)

    observerRef.current.observe(node)
  }

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  return { ref, inView }
}
