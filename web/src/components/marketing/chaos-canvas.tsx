import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createChaosSimulation } from '@/components/marketing/chaos-simulation'
import type { ChaosSimulation } from '@/components/marketing/chaos-simulation'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'
import { mergeRefs } from '@/lib/utils'

// No triggerOnce: the loop must stop again once the canvas scrolls back out of view.
const OBSERVER_OPTIONS = { rootMargin: '100px' }

export function ChaosCanvas(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const simRef = useRef<ChaosSimulation | null>(null)
  const { ref: observerRef, inView } = useIntersectionObserver(OBSERVER_OPTIONS)
  const setRefs = mergeRefs<HTMLCanvasElement>(canvasRef, observerRef)

  useEffect((): (() => void) => {
    const canvas = canvasRef.current
    if (canvas === null) return (): void => {}
    const sim = createChaosSimulation(canvas)
    simRef.current = sim
    return (): void => {
      sim?.destroy()
      simRef.current = null
    }
  }, [])

  // Declared after the setup effect so simRef is populated by the time this first runs.
  useEffect(() => {
    simRef.current?.setInView(inView)
  }, [inView])

  return <canvas ref={setRefs} aria-hidden="true" className="w-full h-full" />
}
