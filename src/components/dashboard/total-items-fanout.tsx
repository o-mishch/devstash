'use client'

import type { CSSProperties, MouseEvent, TouchEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { StatChipBody, STAT_CHIP_CLASS, STAT_COLORS } from './stat-chip'
import { useMediaQuery } from '@/hooks/use-media-query'
import { SYSTEM_TYPE_ORDER, SYSTEM_TYPE_COLORS, SYSTEM_TYPE_ICON_NAMES } from '@/lib/utils/constants'
import { getTypeLabel } from '@/lib/utils/items'
import { getTypeHref } from '@/components/layout/sidebar/utils'

interface TotalItemsFanoutProps {
  totalItems: number
}

const TILE_HALF = 28
const CLOSE_MS = 500
const STAGGER_MS = 32
// Slow, deliberate "dive-in" before the route changes so the redirect reads as an animation.
const NAV_MS = 600
const VIEWPORT_MARGIN = 12
// Floor for the auto-shrunk radius so circles stay legible on very narrow screens (below this the
// arc would mush together); above ~300px the radius is the full per-breakpoint value below.
const MIN_RADIUS = 130
// How far (px) the hovered/active label flies out from its circle center, along that circle's own
// radial direction — so labels fan out around the arc instead of all sitting underneath.
const LABEL_DISTANCE = 64

// Fan geometry — the down-right arc the tiles spread along (0° = right, 90° = straight down).
// Desktop spreads wide into open space; mobile uses a tighter radius with a wider angle so it
// still fits before the whole group is viewport-clamped.
const FAN_RADIUS = { desktop: 244, mobile: 158 }
const FAN_ARC_START_DEG = 10
const FAN_ARC_END_DEG = { desktop: 102, mobile: 120 }

const TYPES = SYSTEM_TYPE_ORDER.map((name) => ({
  name,
  label: getTypeLabel(name),
  href: getTypeHref(name),
  icon: SYSTEM_TYPE_ICON_NAMES[name],
  color: SYSTEM_TYPE_COLORS[name],
}))

export function TotalItemsFanout({ totalItems }: TotalItemsFanoutProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [shiftX, setShiftX] = useState(0)
  // Index of the tile currently under the finger on touch devices (no hover) — drives the same
  // dock-magnification the desktop hover does.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const firstTileRef = useRef<HTMLAnchorElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fan the tiles across the down-and-right arc, then clamp the whole group to the viewport (measure).
  const { tiles, minTileX, maxTileX } = useMemo(() => {
    const baseRadius = isDesktop ? FAN_RADIUS.desktop : FAN_RADIUS.mobile
    const arcStart = (FAN_ARC_START_DEG * Math.PI) / 180
    const arcEnd = ((isDesktop ? FAN_ARC_END_DEG.desktop : FAN_ARC_END_DEG.mobile) * Math.PI) / 180
    const angles = TYPES.map(
      (_, i) => arcStart + (TYPES.length === 1 ? 0.5 : i / (TYPES.length - 1)) * (arcEnd - arcStart),
    )
    // Shrink the radius on narrow viewports so the full arc (tile radii + margins included) fits
    // on screen instead of being clipped at the edge; floored so the circles never collapse.
    const cosines = angles.map(Math.cos)
    const cosSpan = Math.max(...cosines) - Math.min(...cosines)
    const available = (viewportWidth || 1024) - 2 * VIEWPORT_MARGIN - 2 * TILE_HALF
    const fitRadius = cosSpan > 0 ? available / cosSpan : baseRadius
    const radius = Math.max(MIN_RADIUS, Math.min(baseRadius, fitRadius))
    const built = TYPES.map((type, i) => ({
      ...type,
      x: Math.cos(angles[i]) * radius,
      y: Math.sin(angles[i]) * radius,
      dirX: Math.cos(angles[i]),
      dirY: Math.sin(angles[i]),
    }))
    return {
      tiles: built,
      minTileX: Math.min(...built.map((t) => t.x)),
      maxTileX: Math.max(...built.map((t) => t.x)),
    }
  }, [isDesktop, viewportWidth])

  const openFan = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setMounted(true)
    setOpen(true)
  }

  const closeFan = useCallback(() => {
    setOpen(false)
    setRevealed(false)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setMounted(false), CLOSE_MS)
  }, [])

  // Launch a tile: collapse the whole fan (all circles retract to the launcher) AND unmount it via
  // closeFan, then change the route once that close animation has played — a slow, deliberate
  // redirect that leaves no circles behind when the user returns to the dashboard.
  const launchTile = useCallback(
    (href: string) => {
      if (navTimer.current) return
      closeFan()
      navTimer.current = setTimeout(() => {
        // Clear the guard so a later open → click still navigates if this component
        // instance is reused (App Router keeps the dashboard in its client cache).
        navTimer.current = null
        router.push(href)
      }, NAV_MS)
    },
    [router, closeFan],
  )

  const handleTileClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string) => {
      e.preventDefault()
      launchTile(href)
    },
    [launchTile],
  )

  // Touch dock-magnification: phones have no hover, so we track the finger across the fan and
  // magnify whichever tile sits beneath it, launching that tile on release. elementFromPoint is the
  // only way to hit-test the moving touch point against the tiles (no React/ref equivalent exists).
  const updateActiveFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)
    const tileEl = el?.closest<HTMLElement>('[data-tile-index]')
    setActiveIndex(tileEl ? Number(tileEl.dataset.tileIndex) : null)
  }, [])

  const handleTouchTrack = (e: TouchEvent<HTMLDivElement>) => {
    if (!revealed) return
    const touch = e.touches[0]
    if (touch) updateActiveFromPoint(touch.clientX, touch.clientY)
  }

  const handleTouchEnd = () => {
    if (activeIndex !== null) launchTile(tiles[activeIndex].href)
    setActiveIndex(null)
  }

  // Track viewport width so the fan radius can auto-shrink to fit narrow screens (see geometry memo).
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Reveal + viewport-clamp once mounted. Done in rAF (async) so we never call
  // setState synchronously inside the effect body.
  useEffect(() => {
    if (!mounted) return
    const raf = requestAnimationFrame(() => {
      const wrap = wrapperRef.current
      if (wrap) {
        const rect = wrap.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const minX = centerX + minTileX - TILE_HALF
        const maxX = centerX + maxTileX + TILE_HALF
        let shift = 0
        // window.innerWidth is the only source for the viewport edge; needed so the
        // fan stays on screen when the launcher sits near a narrow viewport's edge.
        if (minX < VIEWPORT_MARGIN) shift = VIEWPORT_MARGIN - minX
        else if (maxX > window.innerWidth - VIEWPORT_MARGIN) shift = window.innerWidth - VIEWPORT_MARGIN - maxX
        setShiftX(shift)
      }
      setRevealed(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [mounted, minTileX, maxTileX])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeFan()
        launcherRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeFan])

  useEffect(() => {
    if (revealed) firstTileRef.current?.focus()
  }, [revealed])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (navTimer.current) clearTimeout(navTimer.current)
  }, [])

  const lastIndex = tiles.length - 1

  const getTileStyle = (tile: (typeof tiles)[number], i: number): CSSProperties => {
    if (revealed) {
      return {
        transform: `translate(${tile.x}px, ${tile.y}px) scale(1)`,
        opacity: 1,
        transitionDelay: `${i * STAGGER_MS}ms`,
      }
    }
    // Retract to the launcher — both on normal close and after a tile is pressed.
    return {
      transform: 'translate(0px, 0px) scale(0.3)',
      opacity: 0,
      transitionDelay: `${(lastIndex - i) * STAGGER_MS}ms`,
    }
  }

  return (
    <div ref={wrapperRef} className="relative flex min-w-0 grow basis-[calc(50%-0.25rem)] sm:basis-0">
      <button
        ref={launcherRef}
        type="button"
        className={`${STAT_CHIP_CLASS} relative z-50 w-full`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? closeFan() : openFan())}
      >
        <StatChipBody icon={Package} value={totalItems} label="Total Items" color={STAT_COLORS.total} />
      </button>

      {mounted && (
        <>
          {/* Backdrop: dims the page so the fan reads as a spotlight, and closes on click-away */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            style={{ opacity: revealed ? 1 : 0 }}
            className="fixed inset-0 z-40 cursor-default bg-background/70 backdrop-blur-sm transition-opacity duration-200"
            onClick={closeFan}
          />

          <div
            role="menu"
            aria-label="Browse items by type"
            style={{ transform: `translateX(${shiftX}px)` }}
            className="pointer-events-none absolute left-1/2 top-1/2 z-50"
            onTouchStart={handleTouchTrack}
            onTouchMove={handleTouchTrack}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => setActiveIndex(null)}
          >
            {tiles.map((tile, i) => (
              <Link
                key={tile.name}
                ref={i === 0 ? firstTileRef : undefined}
                href={tile.href}
                prefetch={false}
                role="menuitem"
                aria-label={tile.label}
                data-tile-index={i}
                data-active={activeIndex === i}
                onClick={(e) => handleTileClick(e, tile.href)}
                style={getTileStyle(tile, i)}
                className="group/tile pointer-events-auto absolute -ml-7 -mt-7 touch-none rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:z-10 focus-visible:z-10 focus-visible:outline-none data-[active=true]:z-10"
              >
                {/* Inner circle handles the macOS-dock magnification (grows upward from its base),
                    kept on a separate element so it composes with the position/scale transform on
                    the Link above. Magnifies on hover (desktop) and on data-active (touch swipe). */}
                <span className="flex size-14 origin-bottom items-center justify-center rounded-full border bg-card shadow-md ring-1 ring-foreground/10 transition-transform duration-200 ease-out group-hover/tile:scale-[1.5] group-hover/tile:shadow-xl group-data-[active=true]/tile:scale-[1.5] group-data-[active=true]/tile:shadow-xl group-focus-visible/tile:scale-[1.5] group-focus-visible/tile:ring-2 group-focus-visible/tile:ring-ring">
                  <span
                    className="flex size-11 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${tile.color}24` }}
                  >
                    <ItemTypeIcon iconName={tile.icon} color={tile.color} className="size-5" />
                  </span>
                </span>
                {/* Type-name label: on hover (desktop) / swipe-active (touch) / focus it springs OUT
                    from the circle center along that circle's own radial direction (--lx/--ly), so the
                    labels fan out around the arc. Hidden state sits at the circle center, scaled down,
                    so it reads as shooting out of the circle. */}
                <span
                  aria-hidden="true"
                  style={
                    {
                      // Desktop labels fly OUTWARD along the radial; mobile flies INWARD (toward the
                      // center) so they stay on-screen within the viewport-clamped fan.
                      '--lx': `${tile.dirX * LABEL_DISTANCE * (isDesktop ? 1 : -1)}px`,
                      '--ly': `${tile.dirY * LABEL_DISTANCE * (isDesktop ? 1 : -1)}px`,
                    } as CSSProperties
                  }
                  className="pointer-events-none absolute left-1/2 top-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-popover px-2.5 py-1 text-xs font-semibold text-popover-foreground opacity-0 shadow-lg ring-1 ring-foreground/10 [transform:translate(-50%,-50%)_scale(0.4)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/tile:opacity-100 group-hover/tile:[transform:translate(-50%,-50%)_translate(var(--lx),var(--ly))_scale(1)] group-data-[active=true]/tile:opacity-100 group-data-[active=true]/tile:[transform:translate(-50%,-50%)_translate(var(--lx),var(--ly))_scale(1)] group-focus-visible/tile:opacity-100 group-focus-visible/tile:[transform:translate(-50%,-50%)_translate(var(--lx),var(--ly))_scale(1)]"
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: tile.color }} />
                  {tile.label}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
