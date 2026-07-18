import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface GradientCtaProps {
  /** Typed against the route tree — a path that doesn't exist is a compile error here. */
  href: LinkProps['to']
  children: ReactNode
  className?: string
  /** Height utility; defaults to h-11. Explicit prop instead of sniffing className for `h-`. */
  height?: string
}

/**
 * Shared blue→cyan gradient-pill background + hover/active motion. The single source of truth
 * for the marketing CTA gradient — reused by the nav CTAs (homepage-nav) which layer their own
 * shape/color tokens on top. Callers own radius, padding, height, text color, and shadow.
 */
export const GRADIENT_PILL_CLASS =
  'bg-gradient-to-r from-blue-500 to-cyan-500 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95'

/**
 * Blue→indigo gradient clipped to text — the marketing heading accent. One source of truth
 * so the section headings that wrap their accented words in a `<span>` can't drift. Already
 * includes `bg-clip-text text-transparent`.
 */
export const GRADIENT_TEXT_CLASS =
  'bg-gradient-to-r from-blue-600 to-indigo-400 bg-clip-text text-transparent'

/**
 * The centered content column every marketing section (and the nav/footer) shares. Compose
 * with `cn(MARKETING_CONTAINER, 'relative')` where a section positions children against it.
 */
export const MARKETING_CONTAINER = 'container mx-auto max-w-6xl px-4'

/**
 * The decorative ambient glow blob the marketing sections layer behind their content — a soft,
 * blurred, pointer-transparent circle. One source of truth for the base treatment so the sizes
 * and blur can't drift; callers add position/size/color, e.g.
 * `cn(GLOW_BLOB, 'left-1/2 h-[500px] w-[700px] bg-blue-500/10')`.
 */
export const GLOW_BLOB = 'pointer-events-none absolute rounded-full blur-3xl'

/** Gradient pill CTA linking to an in-app route. */
export function GradientCta({
  href,
  children,
  className,
  height = 'h-11',
}: GradientCtaProps): ReactNode {
  const baseClassName = cn(
    'inline-flex items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold text-slate-900 shadow-lg shadow-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50',
    GRADIENT_PILL_CLASS,
    height,
    className,
  )

  return (
    <Link to={href} className={baseClassName}>
      {children}
    </Link>
  )
}
