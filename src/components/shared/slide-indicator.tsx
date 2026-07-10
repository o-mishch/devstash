'use client'

import { memo, useMemo } from 'react'
import { motion, useReducedMotion, type Transition } from 'motion/react'

interface SlideIndicatorProps {
  layoutId: string
}

// Shared sliding-fill indicator for segmented toggles/tabs (currently the theme switch). One source for
// the spring + prefers-reduced-motion gate so every segmented control animates identically and honors
// reduced motion. Each consumer must pass a UNIQUE `layoutId` — motion shared-layout treats a reused id
// across two mounted controls as the same element and animates the fill flying between them.
export const SlideIndicator = memo(function SlideIndicator({ layoutId }: SlideIndicatorProps) {
  const shouldReduce = useReducedMotion()
  
  const transition: Transition = useMemo(() => shouldReduce
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 30 }
  , [shouldReduce])

  return (
    <motion.div
      layoutId={layoutId}
      className="absolute inset-0 rounded-md bg-primary z-0"
      transition={transition}
    />
  )
})
