import { useEffect, useRef, useState } from 'react'

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  triggerOnce?: boolean
}

interface UseIntersectionObserverResult {
  ref: (node: HTMLElement | null) => void
  inView: boolean
}

export function useIntersectionObserver(options?: UseIntersectionObserverOptions): UseIntersectionObserverResult {
  const [inView, setInView] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const ref = (node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!node) return

    observerRef.current = new IntersectionObserver(([entry]) => {
      const isIntersecting = entry.isIntersecting
      setInView(isIntersecting)
      
      if (isIntersecting && options?.triggerOnce && observerRef.current) {
        observerRef.current.disconnect()
      }
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
