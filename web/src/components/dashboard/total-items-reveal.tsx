import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ITEM_TYPES } from '@/lib/item-types'
import type { ItemTypeName } from '@/lib/item-types'

// A "browse by type" reveal anchored to a skin's Total Items element — click the total → jump to any
// item type, with a per-skin animation so the interaction feels native to that skin. The panel
// renders in a portal with fixed positioning so it floats above the layout (skin cards use
// overflow:hidden, which would otherwise clip it). All motion is gated by prefers-reduced-motion
// (falls back to a plain fade). Ported from the legacy client island onto TanStack Router + motion.

export type RevealVariant = 'pop' | 'float' | 'terminal' | 'neon' | 'list'

interface DashboardTypeShortcut {
  name: ItemTypeName
  label: string
  icon: LucideIcon
  color: string
}

// The item types as "browse by type" shortcuts, in registry order. Built from the single ITEM_TYPES
// source (icon + hex per type) so the reveal, sidebar, and cards stay in lockstep.
const TYPES: DashboardTypeShortcut[] = ITEM_TYPES.map((t) => ({
  name: t.name,
  label: t.label,
  icon: t.icon,
  color: t.hex,
}))

// Precomputed once — TYPES is a fixed, module-level list, so each type's neon border/glow style has
// no dependency on props/state/closures.
const NEON_STYLES: Record<string, CSSProperties> = Object.fromEntries(
  TYPES.map((t) => [
    t.name,
    { borderColor: `${t.color}66`, boxShadow: `0 0 14px -6px ${t.color}` },
  ]),
)

const SPRING = { type: 'spring', stiffness: 480, damping: 26 } as const

interface VariantConfig {
  width: number
  panel: string
  container: Variants
  item: Variants
  tile: string
  renderTile: (t: DashboardTypeShortcut) => ReactNode
}

interface TypeGlyphProps {
  shortcut: DashboardTypeShortcut
  className?: string
}

/** The type's lucide glyph tinted with its hex color (currentColor via inline style). */
function TypeGlyph({ shortcut, className }: TypeGlyphProps): ReactNode {
  const Icon = shortcut.icon
  return (
    <Icon
      className={className}
      // oxlint-disable-next-line react/forbid-component-props -- runtime per-type glyph color
      style={{ color: shortcut.color }}
      aria-hidden="true"
    />
  )
}

interface IconBadgeProps {
  shortcut: DashboardTypeShortcut
  size: string
}

function IconBadge({ shortcut, size }: IconBadgeProps): ReactNode {
  return (
    <span
      className={cn('grid place-items-center rounded-lg', size)}
      // oxlint-disable-next-line react/forbid-dom-props -- runtime per-type badge tint
      style={{ backgroundColor: `${shortcut.color}24`, color: shortcut.color }}
    >
      <TypeGlyph shortcut={shortcut} className="size-4" />
    </span>
  )
}

const CONFIGS: Record<RevealVariant, VariantConfig> = {
  // Aurora / Mission Control / Holographic — glassy spring-pop grid.
  pop: {
    width: 280,
    panel:
      'grid grid-cols-3 gap-2 rounded-2xl border border-border bg-popover/95 p-2.5 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.035 } } },
    item: {
      hidden: { opacity: 0, scale: 0.5, y: 10 },
      show: { opacity: 1, scale: 1, y: 0, transition: SPRING },
    },
    tile: 'flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card p-2.5 text-center transition-colors hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        <IconBadge shortcut={t} size="size-8" />
        <span className="truncate text-[11px] font-medium">{t.label}</span>
      </>
    ),
  },
  // Spatial — frosted tiles float up out of depth (blur → sharp).
  float: {
    width: 300,
    panel:
      'grid grid-cols-3 gap-3 rounded-3xl border border-foreground/15 bg-popover/80 p-3 shadow-2xl backdrop-blur-2xl',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, y: 26, filter: 'blur(10px)' },
      show: {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
      },
    },
    tile: 'flex flex-col items-center gap-2 rounded-2xl border border-foreground/15 bg-card/80 p-3 text-center shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform hover:-translate-y-0.5',
    renderTile: (t) => (
      <>
        <IconBadge shortcut={t} size="size-9" />
        <span className="truncate text-[11px] font-medium">{t.label}</span>
      </>
    ),
  },
  // Command Deck — terminal scan: rows type in left-to-right, monospace.
  terminal: {
    width: 260,
    panel:
      'flex flex-col gap-1 rounded-md border border-primary/30 bg-popover/95 p-2 font-mono shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.06 } } },
    item: {
      hidden: { opacity: 0, x: -10 },
      show: { opacity: 1, x: 0, transition: { duration: 0.16 } },
    },
    tile: 'flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-primary/10',
    renderTile: (t) => (
      <>
        <span className="text-primary">▸</span>
        <TypeGlyph shortcut={t} className="size-3.5" />
        <span className="lowercase">{t.label}</span>
      </>
    ),
  },
  // Neon Grid — tiles slide in along x with a neon glow.
  neon: {
    width: 260,
    panel:
      'flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-popover/90 p-2.5 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.045 } } },
    item: {
      hidden: { opacity: 0, x: -24 },
      show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 320, damping: 24 } },
    },
    tile: 'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-[background-color,transform] hover:-translate-y-px hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        <TypeGlyph shortcut={t} className="size-4" />
        <span className="font-mono lowercase">{t.label}</span>
      </>
    ),
  },
  // Editorial — Swiss list, staggered slide from the left over hairline rules.
  list: {
    width: 240,
    panel:
      'flex flex-col overflow-hidden rounded-lg border border-border bg-popover/95 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.04 } } },
    item: {
      hidden: { opacity: 0, x: -16 },
      show: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
    },
    tile: 'flex items-center gap-3 border-b border-border px-3 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        <TypeGlyph shortcut={t} className="size-4" />
        <span className="capitalize">{t.label}</span>
      </>
    ),
  },
}

interface PanelCoords {
  top: number
  left: number
}

interface TotalItemsRevealProps {
  variant: RevealVariant
  children: ReactNode
  /** className for the trigger button (wraps the skin's own Total Items markup). */
  className?: string
  /** Inline style for the trigger button — e.g. a per-skin CSS var the className consumes. */
  style?: CSSProperties
  /** Anchor the panel to the trigger's left edge or its horizontal center. */
  align?: 'left' | 'center'
}

const VIEWPORT_MARGIN = 8

export function TotalItemsReveal({
  variant,
  children,
  className,
  style,
  align = 'left',
}: TotalItemsRevealProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<PanelCoords | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReducedMotion()
  const panelId = useId()
  const cfg = CONFIGS[variant]

  // Position the fixed panel under the trigger, clamped into the viewport. window/document access is
  // required here: the panel is portaled to <body>, so it must be placed from the trigger's measured
  // rect — there is no framework-level anchor primitive for this.
  const place = (): void => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rawLeft = align === 'center' ? rect.left + rect.width / 2 - cfg.width / 2 : rect.left
    const maxLeft = window.innerWidth - cfg.width - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft))
    setCoords({ top: rect.bottom + 8, left })
  }

  const openPanel = (): void => {
    place()
    setOpen(true)
  }

  const closePanel = useCallback(() => setOpen(false), [])

  // Reads the latest `place` without re-running the effect when its closure deps change — only
  // `open` should drive listener attach/detach.
  const repositionOnResize = useEffectEvent(() => place())

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Reposition on resize; close on scroll (a fixed panel would otherwise detach from the trigger).
    const onResize = (): void => repositionOnResize()
    const onScroll = (): void => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return (): void => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // motion/AnimatePresence is animation-driven, so stabilizing the variants/style objects it
  // receives avoids handing it a new object identity on every unrelated re-render.
  const container = useMemo<Variants>(
    () => (reduceMotion === true ? { hidden: {}, show: {} } : cfg.container),
    [reduceMotion, cfg],
  )
  const item = useMemo<Variants>(
    () => (reduceMotion === true ? { hidden: { opacity: 0 }, show: { opacity: 1 } } : cfg.item),
    [reduceMotion, cfg],
  )
  const panelStyle = useMemo<CSSProperties | undefined>(
    () =>
      coords
        ? { position: 'fixed', top: coords.top, left: coords.left, width: cfg.width }
        : undefined,
    [coords, cfg.width],
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn('text-left', className)}
        // oxlint-disable-next-line react/forbid-dom-props -- per-skin CSS var forwarded by the caller
        style={style}
      >
        {children}
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={closePanel}
                  className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
                />
                <motion.div
                  id={panelId}
                  role="menu"
                  aria-label="Browse items by type"
                  initial="hidden"
                  animate="show"
                  exit="hidden"
                  variants={container}
                  style={panelStyle}
                  className={cn('z-50 max-w-[calc(100vw-16px)]', cfg.panel)}
                >
                  {TYPES.map((t) => (
                    <motion.div key={t.name} variants={item}>
                      <Link
                        to="/items/$type"
                        params={{ type: t.name }}
                        role="menuitem"
                        tabIndex={0}
                        onClick={closePanel}
                        className={cn(cfg.tile)}
                        // oxlint-disable-next-line react/forbid-component-props -- variant-selected neon style map
                        style={variant === 'neon' ? NEON_STYLES[t.name] : undefined}
                      >
                        {cfg.renderTile(t)}
                      </Link>
                    </motion.div>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          // createPortal requires a real DOM node as its mount target — there is no React ref/element
          // alternative here since the overlay must escape this component's stacking context.
          document.body,
        )}
    </>
  )
}
