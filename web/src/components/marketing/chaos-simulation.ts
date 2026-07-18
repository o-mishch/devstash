import { loadCanvasIcons } from '@/components/marketing/canvas-icons'

/**
 * Imperative handle the React component drives. Everything else — the icons, the pointer,
 * the rAF lifecycle, the 2D context — is owned in here and never crosses into React.
 */
export interface ChaosSimulation {
  setInView: (value: boolean) => void
  destroy: () => void
}

interface FloatingIcon {
  img: HTMLImageElement
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  rotV: number
  scale: number
  scaleT: number
}

/** Latest pointer position in logical (CSS) pixels; off-screen sentinel until first move. */
interface MousePosition {
  x: number
  y: number
}

const ICON_R = 22
const SPEED = 0.6

/** Returns null when the canvas has no 2D context, leaving the element blank. */
export function createChaosSimulation(canvas: HTMLCanvasElement): ChaosSimulation | null {
  const rawCtx = canvas.getContext('2d')
  if (rawCtx === null) return null
  const ctx = rawCtx

  let icons: FloatingIcon[] = []
  const mouse: MousePosition = { x: -9999, y: -9999 }
  let raf = 0
  let cancelled = false
  // The physics and every draw work in LOGICAL (CSS) pixels; the backing store is scaled up
  // by devicePixelRatio in resize() so the icons stay crisp on HiDPI displays.
  let cssW = 0
  let cssH = 0
  let ready = false
  let visible = false
  let running = false
  // matchMedia: no framework-level alternative for reading the motion preference.
  // When the user prefers reduced motion, draw a single static frame instead of animating.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  let prefersReducedMotion = motionQuery.matches

  // Single owner of the rAF lifecycle: run only while the canvas is on screen, the icons
  // have loaded, and the user hasn't asked for reduced motion.
  function sync(): void {
    const shouldRun = ready && visible && !prefersReducedMotion
    if (shouldRun && !running) {
      running = true
      raf = requestAnimationFrame(tick)
    } else if (!shouldRun && running) {
      running = false
      cancelAnimationFrame(raf)
    }
  }

  function resize(): void {
    // Both axes off the CANVAS, not one off the parent: the physics bounds, `clearRect`, and
    // the pointer mapping (which divides by this canvas's own rect) must all agree on one
    // box. Taking the width from `parent.clientWidth` only matched because the wrapper has no
    // padding — add some and the right-hand wall would sit outside the drawn area, bouncing
    // icons off nothing while the pointer ratio quietly compensated for a mismatch the
    // renderer never saw.
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    cssW = rect.width
    cssH = rect.height || 240
    // window.devicePixelRatio: no framework-level way to read the display's pixel density.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    // Assigning width/height resets the context, so (re)apply the DPR scale afterwards —
    // every subsequent draw call can then use logical coordinates.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    icons.forEach((ic) => {
      ic.x = Math.min(Math.max(ic.x, ICON_R), cssW - ICON_R)
      ic.y = Math.min(Math.max(ic.y, ICON_R), cssH - ICON_R)
    })
    // Reassigning width/height above clears the canvas. When animating, the next rAF frame
    // repaints; under reduced motion nothing reschedules, so repaint the static frame here or
    // the icons vanish after a resize/orientation change. `draw`, never `tick`: this must not
    // advance the simulation for someone who asked for no motion.
    if (prefersReducedMotion && icons.length > 0) draw()
  }

  function spawn(images: HTMLImageElement[]): void {
    const W = cssW || 400
    const H = cssH || 240
    icons = images.map((img) => {
      return {
        img,
        x: ICON_R * 2 + Math.random() * (W - ICON_R * 4),
        y: ICON_R * 2 + Math.random() * (H - ICON_R * 4),
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.015,
        scale: 1,
        scaleT: Math.random() * Math.PI * 2,
      }
    })
  }

  /** Advance the simulation by one frame. Mutates every icon; paints nothing. */
  function step(): void {
    const W = cssW
    const H = cssH

    icons.forEach((ic) => {
      const dx = ic.x - mouse.x
      const dy = ic.y - mouse.y
      const dist = Math.hypot(dx, dy)
      const repelRadius = 100
      if (dist < repelRadius && dist > 0) {
        const force = ((repelRadius - dist) / repelRadius) * 3
        ic.vx += (dx / dist) * force * 0.04
        ic.vy += (dy / dist) * force * 0.04
      }

      ic.vx *= 0.985
      ic.vy *= 0.985

      const cx = W / 2
      const cy = H / 2
      const fromCenter = Math.hypot(ic.x - cx, ic.y - cy)
      if (fromCenter > Math.hypot(W / 2, H / 2) * 0.85) {
        ic.vx += (cx - ic.x) * 0.002
        ic.vy += (cy - ic.y) * 0.002
      }

      if (Math.abs(ic.vx) < 0.1 && Math.abs(ic.vy) < 0.1) {
        ic.vx += (Math.random() - 0.5) * 0.3
        ic.vy += (Math.random() - 0.5) * 0.3
      }

      const speed = Math.hypot(ic.vx, ic.vy)
      if (speed > 3) {
        ic.vx = (ic.vx / speed) * 3
        ic.vy = (ic.vy / speed) * 3
      }

      ic.x += ic.vx
      ic.y += ic.vy

      if (ic.x < ICON_R) {
        ic.x = ICON_R
        ic.vx = Math.abs(ic.vx)
      }
      if (ic.x > W - ICON_R) {
        ic.x = W - ICON_R
        ic.vx = -Math.abs(ic.vx)
      }
      if (ic.y < ICON_R) {
        ic.y = ICON_R
        ic.vy = Math.abs(ic.vy)
      }
      if (ic.y > H - ICON_R) {
        ic.y = H - ICON_R
        ic.vy = -Math.abs(ic.vy)
      }

      ic.rot += ic.rotV
      ic.scaleT += 0.025
      ic.scale = 1 + Math.sin(ic.scaleT) * 0.06
    })
  }

  /** Paint the current state. Reads every icon; mutates nothing. */
  function draw(): void {
    ctx.clearRect(0, 0, cssW, cssH)
    const S = ICON_R * 2
    icons.forEach((ic) => {
      ctx.save()
      ctx.translate(ic.x, ic.y)
      ctx.rotate(ic.rot)
      ctx.scale(ic.scale, ic.scale)
      ctx.drawImage(ic.img, -ICON_R, -ICON_R, S, S)
      ctx.restore()
    })
  }

  // The animation frame: advance, then paint. Split from `draw` because a resize under
  // reduced motion has to REPAINT without advancing — calling the combined function there
  // nudged every icon one physics step per resize, handing a user who asked for no motion a
  // jerky animation driven by their own window dragging.
  function tick(): void {
    // Only sync() flips `running`, so a paused call renders one frame and never reschedules.
    if (running) {
      raf = requestAnimationFrame(tick)
    }
    step()
    draw()
  }

  const onMouseMove = (e: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    // A pointer event can fire before the first resize() lays the canvas out (rect 0×0); guard the
    // divide so an early move maps to a neutral off-canvas point instead of NaN/Infinity.
    if (rect.width === 0 || rect.height === 0) return
    mouse.x = (e.clientX - rect.left) * (cssW / rect.width)
    mouse.y = (e.clientY - rect.top) * (cssH / rect.height)
  }
  const onMouseLeave = (): void => {
    mouse.x = -9999
    mouse.y = -9999
  }
  const trackTouch = (t: Touch): void => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    mouse.x = (t.clientX - rect.left) * (cssW / rect.width)
    mouse.y = (t.clientY - rect.top) * (cssH / rect.height)
  }
  const burst = (): void => {
    const burstRadius = 130
    icons.forEach((ic) => {
      const dx = ic.x - mouse.x
      const dy = ic.y - mouse.y
      const dist = Math.hypot(dx, dy)
      if (dist < burstRadius && dist > 0) {
        const force = ((burstRadius - dist) / burstRadius) * 4
        ic.vx += (dx / dist) * force
        ic.vy += (dy / dist) * force
      }
    })
  }
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0]
    if (t) {
      trackTouch(t)
      burst()
    }
  }
  const onTouchMove = (e: TouchEvent): void => {
    const t = e.touches[0]
    if (t) trackTouch(t)
  }
  const onTouchEnd = (): void => {
    mouse.x = -9999
    mouse.y = -9999
  }

  // MediaQueryList is an event target precisely so a mid-session preference change takes
  // effect without a reload — a user often enables Reduce Motion *because* of an animation.
  const onMotionChange = (e: MediaQueryListEvent): void => {
    prefersReducedMotion = e.matches
    sync()
    // sync() has stopped the loop by now; repaint the frozen frame it left behind — the
    // preference just turned motion OFF, so this must not advance it one more step.
    if (prefersReducedMotion && ready) draw()
  }
  motionQuery.addEventListener('change', onMotionChange)

  const resizeObserver = new ResizeObserver(() => resize())
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseleave', onMouseLeave)
  canvas.addEventListener('touchstart', onTouchStart, { passive: true })
  canvas.addEventListener('touchmove', onTouchMove, { passive: true })
  canvas.addEventListener('touchend', onTouchEnd)
  canvas.addEventListener('touchcancel', onTouchEnd)

  const init = async (): Promise<void> => {
    try {
      const images = await loadCanvasIcons()
      if (cancelled) return
      // Every icon failed to decode (e.g. a CSP img-src regression) — bail rather than run a
      // rAF loop that clears an empty canvas forever.
      if (images.length === 0) return
      resize()
      spawn(images)
      ready = true
      // Under reduced motion the icons still have to appear — paint their spawned positions
      // once, without starting (or advancing) the simulation.
      if (prefersReducedMotion) draw()
      else sync()
    } catch (err: unknown) {
      console.error('Failed to load canvas icons:', err)
    }
  }
  void init()

  return {
    setInView: (value: boolean): void => {
      visible = value
      sync()
    },
    destroy: (): void => {
      cancelled = true
      running = false
      cancelAnimationFrame(raf)
      motionQuery.removeEventListener('change', onMotionChange)
      resizeObserver.disconnect()
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    },
  }
}
