'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { cn } from '@/lib/utils'
import { getDashboardTypeShortcuts, type DashboardTypeShortcut } from './type-shortcuts'

// A "browse by type" reveal anchored to a skin's Total Items element — same intent as the classic
// TotalItemsFanout (click the total → jump to any item type) but each skin gets its OWN animation so
// the interaction feels native to that skin. The panel renders in a portal with fixed positioning so
// it floats above the layout (skin cards use overflow:hidden, which would otherwise clip it). All
// motion is gated by prefers-reduced-motion (falls back to a plain fade). Client island.

export type RevealVariant = 'pop' | 'float' | 'terminal' | 'neon' | 'list'

const TYPES = getDashboardTypeShortcuts()

interface VariantConfig {
  width: number
  panel: string
  container: Variants
  item: Variants
  tile: string
  renderTile: (t: DashboardTypeShortcut) => ReactNode
}

const SPRING = { type: 'spring', stiffness: 480, damping: 26 } as const

function iconBadge(t: DashboardTypeShortcut, size: string) {
  return (
    <span
      className={cn('grid place-items-center rounded-lg', size)}
      style={{ backgroundColor: `${t.color}24`, color: t.color }}
    >
      <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4" />
    </span>
  )
}

const CONFIGS: Record<RevealVariant, VariantConfig> = {
  // Aurora / Mission Control / Holographic — glassy spring-pop grid.
  pop: {
    width: 280,
    panel: 'grid grid-cols-3 gap-2 rounded-2xl border border-border bg-popover/95 p-2.5 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.035 } } },
    item: {
      hidden: { opacity: 0, scale: 0.5, y: 10 },
      show: { opacity: 1, scale: 1, y: 0, transition: SPRING },
    },
    tile: 'flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card p-2.5 text-center transition-colors hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        {iconBadge(t, 'size-8')}
        <span className="truncate text-[11px] font-medium">{t.label}</span>
      </>
    ),
  },
  // Spatial — frosted tiles float up out of depth (blur → sharp).
  float: {
    width: 300,
    panel: 'grid grid-cols-3 gap-3 rounded-3xl border border-foreground/15 bg-popover/80 p-3 shadow-2xl backdrop-blur-2xl',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, y: 26, filter: 'blur(10px)' },
      show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
    },
    tile: 'flex flex-col items-center gap-2 rounded-2xl border border-foreground/15 bg-card/80 p-3 text-center shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-transform hover:-translate-y-0.5',
    renderTile: (t) => (
      <>
        {iconBadge(t, 'size-9')}
        <span className="truncate text-[11px] font-medium">{t.label}</span>
      </>
    ),
  },
  // Command Deck — terminal scan: rows type in left-to-right, monospace.
  terminal: {
    width: 260,
    panel: 'flex flex-col gap-1 rounded-md border border-primary/30 bg-popover/95 p-2 font-mono shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.06 } } },
    item: {
      hidden: { opacity: 0, x: -10 },
      show: { opacity: 1, x: 0, transition: { duration: 0.16 } },
    },
    tile: 'flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-primary/10',
    renderTile: (t) => (
      <>
        <span className="text-primary">▸</span>
        <ItemTypeIcon iconName={t.icon} color={t.color} className="size-3.5" />
        <span className="lowercase">{t.label}</span>
      </>
    ),
  },
  // Neon Grid — tiles slide in along x with a neon glow.
  neon: {
    width: 260,
    panel: 'flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-popover/90 p-2.5 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.045 } } },
    item: {
      hidden: { opacity: 0, x: -24 },
      show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 320, damping: 24 } },
    },
    tile: 'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-[background-color,transform] hover:-translate-y-px hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4" />
        <span className="font-mono lowercase">{t.label}</span>
      </>
    ),
  },
  // Editorial — Swiss list, staggered slide from the left over hairline rules.
  list: {
    width: 240,
    panel: 'flex flex-col overflow-hidden rounded-lg border border-border bg-popover/95 shadow-xl backdrop-blur',
    container: { hidden: {}, show: { transition: { staggerChildren: 0.04 } } },
    item: {
      hidden: { opacity: 0, x: -16 },
      show: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
    },
    tile: 'flex items-center gap-3 border-b border-border px-3 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-foreground/5',
    renderTile: (t) => (
      <>
        <ItemTypeIcon iconName={t.icon} color={t.color} className="size-4" />
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
  /** Anchor the panel to the trigger's left edge or its horizontal center. */
  align?: 'left' | 'center'
}

const VIEWPORT_MARGIN = 8

export function TotalItemsReveal({ variant, children, className, align = 'left' }: TotalItemsRevealProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<PanelCoords | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReducedMotion()
  const panelId = useId()
  const cfg = CONFIGS[variant]

  // Position the fixed panel under the trigger, clamped into the viewport. window/document access is
  // required here: the panel is portaled to <body>, so it must be placed from the trigger's measured
  // rect — there is no framework-level anchor primitive for this.
  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rawLeft = align === 'center' ? rect.left + rect.width / 2 - cfg.width / 2 : rect.left
    const maxLeft = window.innerWidth - cfg.width - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft))
    setCoords({ top: rect.bottom + 8, left })
  }

  const openPanel = () => {
    place()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Reposition on resize; close on scroll (a fixed panel would otherwise detach from the trigger).
    const onResize = () => place()
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const container = reduceMotion ? { hidden: {}, show: {} } : cfg.container
  const item = reduceMotion ? { hidden: { opacity: 0 }, show: { opacity: 1 } } : cfg.item

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn('cursor-pointer text-left', className)}
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
                  onClick={() => setOpen(false)}
                  className="fixed inset-0 z-50 cursor-default bg-background/60 backdrop-blur-sm"
                />
                <motion.div
                  id={panelId}
                  role="menu"
                  aria-label="Browse items by type"
                  initial="hidden"
                  animate="show"
                  exit="hidden"
                  variants={container}
                  style={{ position: 'fixed', top: coords.top, left: coords.left, width: cfg.width } as CSSProperties}
                  className={cn('z-50 max-w-[calc(100vw-16px)]', cfg.panel)}
                >
                  {TYPES.map((t) => (
                    <motion.div key={t.name} variants={item}>
                      <Link
                        href={t.href}
                        prefetch={false}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className={cn('cursor-pointer', cfg.tile)}
                        style={variant === 'neon' ? { borderColor: `${t.color}66`, boxShadow: `0 0 14px -6px ${t.color}` } : undefined}
                      >
                        {cfg.renderTile(t)}
                      </Link>
                    </motion.div>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
