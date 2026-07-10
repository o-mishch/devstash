"use client"

import React from "react"
import { motion, MotionStyle, Transition } from "motion/react"

import { cn } from "@/lib/utils/index"

interface BorderBeamProps {
  /**
   * The size of the border beam.
   */
  size?: number
  /**
   * The duration of the border beam.
   */
  duration?: number
  /**
   * The delay of the border beam.
   */
  delay?: number
  /**
   * The color of the border beam from.
   */
  colorFrom?: string
  /**
   * The color of the border beam to.
   */
  colorTo?: string
  /**
   * The motion transition of the border beam.
   */
  transition?: Transition
  /**
   * The class name of the border beam.
   */
  className?: string
  /**
   * The style of the border beam.
   */
  style?: React.CSSProperties
  /**
   * Whether to reverse the animation direction.
   */
  reverse?: boolean
  /**
   * The initial offset position (0-100).
   */
  initialOffset?: number
  /**
   * The border width of the beam.
   */
  borderWidth?: number
}

const getOuterStyle = (borderWidth: number) => ({
  "--border-beam-width": `${borderWidth}px`,
} as React.CSSProperties)

const getInnerStyle = (size: number, colorFrom: string, colorTo: string, style?: React.CSSProperties) => ({
  width: size,
  offsetPath: `rect(0 auto auto 0 round ${size}px)`,
  "--color-from": colorFrom,
  "--color-to": colorTo,
  ...style,
} as MotionStyle)

const getInitial = (initialOffset: number) => ({
  offsetDistance: `${initialOffset}%`
})

const getAnimate = (initialOffset: number, reverse: boolean) => ({
  offsetDistance: reverse
    ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
    : [`${initialOffset}%`, `${100 + initialOffset}%`],
})

const getBorderBeamTransition = (duration: number, delay: number, transition?: Transition): Transition => ({
  repeat: Infinity,
  ease: "linear" as const,
  duration,
  delay: -delay,
  ...transition,
})

export const BorderBeam = React.memo(function BorderBeam({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={getOuterStyle(borderWidth)}
    >
      <motion.div
        className={cn(
          "absolute aspect-square",
          "bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent",
          className
        )}
        style={getInnerStyle(size, colorFrom, colorTo, style)}
        initial={getInitial(initialOffset)}
        animate={getAnimate(initialOffset, reverse)}
        transition={getBorderBeamTransition(duration, delay, transition)}
      />
    </div>
  )
})
