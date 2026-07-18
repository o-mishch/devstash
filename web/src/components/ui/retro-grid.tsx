import React from 'react'
import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// Magic UI RetroGrid (CSS variant) — a perspective grid horizon driven purely by CSS transforms and
// the `animate-grid` keyframe (defined in globals.css `@theme`). No canvas/WebGL: keeps the ambient
// Pro-skin backdrop light. The scroll animation is gated with `motion-safe:` at the source (the inner
// grid div the caller can't reach), so it self-respects reduced-motion for every skin that uses it.
interface RetroGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Rotation angle of the grid in degrees. */
  angle?: number
  /** Grid cell size in pixels. */
  cellSize?: number
  /** Grid opacity between 0 and 1. */
  opacity?: number
  /** Grid line color in light mode. */
  lightLineColor?: string
  /** Grid line color in dark mode. */
  darkLineColor?: string
}

const getGridStyles = (
  angle: number,
  cellSize: number,
  opacity: number,
  lightLineColor: string,
  darkLineColor: string,
) =>
  ({
    '--grid-angle': `${angle}deg`,
    '--cell-size': `${cellSize}px`,
    '--opacity': opacity,
    '--light-line': lightLineColor,
    '--dark-line': darkLineColor,
  }) as CSSProperties

export const RetroGrid = React.memo(function RetroGrid({
  className,
  angle = 65,
  cellSize = 60,
  opacity = 0.5,
  lightLineColor = 'gray',
  darkLineColor = 'gray',
  ...props
}: RetroGridProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute size-full overflow-hidden opacity-[var(--opacity)] [perspective:200px]',
        className,
      )}
      style={getGridStyles(angle, cellSize, opacity, lightLineColor, darkLineColor)}
      {...props}
    >
      <div className="absolute inset-0 [transform:rotateX(var(--grid-angle))]">
        <div className="motion-safe:animate-grid [background-image:linear-gradient(to_right,var(--light-line)_1px,transparent_0),linear-gradient(to_bottom,var(--light-line)_1px,transparent_0)] [background-repeat:repeat] [background-size:var(--cell-size)_var(--cell-size)] [height:300vh] [inset:0%_0px] [margin-left:-200%] [transform-origin:100%_0_0] [width:600vw] dark:[background-image:linear-gradient(to_right,var(--dark-line)_1px,transparent_0),linear-gradient(to_bottom,var(--dark-line)_1px,transparent_0)]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent to-90%" />
    </div>
  )
})
