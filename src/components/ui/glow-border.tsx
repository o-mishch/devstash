'use client'

import { cn } from '@/lib/utils/index'
import type { CSSProperties } from 'react'

interface GlowBorderProps {
  /** Width of the glowing ring in px. */
  borderWidth?: number
  /** Seconds for one full sweep around the border. */
  duration?: number
  /** Gradient start color (the bright leading edge of the sweep). */
  colorFrom?: string
  /** Gradient end color (trails the leading edge). */
  colorTo?: string
  /** Strength of the outer blurred glow, in px. 0 disables the glow halo. */
  glow?: number
  className?: string
}

/**
 * A rotating conic-gradient ring that traces the rounded border of its positioned parent.
 * One bright arc sweeps continuously around the edge with a soft outer glow, signalling that
 * background work is in flight. Sits as an absolutely-positioned overlay (`pointer-events-none`),
 * so the parent only needs `relative` + `overflow-hidden` + a matching border radius.
 *
 * Masked to a border-box ring (same technique as BorderBeam) so the conic fill shows only on the
 * rounded edge, not over the card body. The angle animates via the registered `--glow-angle`
 * property (see globals.css), which is cheap to repaint and is dropped to a static ring under
 * `prefers-reduced-motion`.
 */
export function GlowBorder({
  borderWidth = 2,
  duration = 4,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  glow = 16,
  className,
}: GlowBorderProps) {
  // One arc of color sweeping from transparent → colorTo → colorFrom → transparent, rotated by the
  // animated angle. The transparent majority keeps it reading as a single travelling highlight
  // rather than a fully-lit ring.
  const sweep = `conic-gradient(from var(--glow-angle), transparent 0deg, ${colorTo} 60deg, ${colorFrom} 110deg, transparent 160deg)`

  // Both layers paint the same sweep but are masked to a border-box ring (interior punched out), so the
  // conic fill never floods the card body — it lives only on the rounded edge. The two full-box mask
  // layers are combined with `exclude`: inner layer clipped to content-box (the band's inner boundary),
  // outer to border-box. `-webkit-` fallback for Safari (xor == exclude here).
  const ringMask = (band: number): CSSProperties =>
    ({
      padding: band,
      maskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
      maskClip: 'content-box, border-box',
      maskComposite: 'exclude',
      WebkitMaskImage: 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)',
      WebkitMaskClip: 'content-box, border-box',
      WebkitMaskComposite: 'xor',
    })

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 rounded-[inherit]', className)}
      style={{ '--glow-duration': `${duration}s` } as CSSProperties}
    >
      {/* Halo: the sweep on a wider ring band, blurred so it blooms around the perimeter (not the centre). */}
      {glow > 0 && (
        <div
          className="animate-glow-border absolute inset-0 rounded-[inherit] opacity-70"
          style={{ background: sweep, filter: `blur(${glow}px)`, ...ringMask(borderWidth + glow / 2) }}
          aria-hidden
        />
      )}
      {/* Crisp ring: the sweep masked to a thin border band of `borderWidth`. */}
      <div
        className="animate-glow-border absolute inset-0 rounded-[inherit]"
        style={{ background: sweep, ...ringMask(borderWidth) }}
        aria-hidden
      />
    </div>
  )
}
