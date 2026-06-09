import type { LucideIcon } from 'lucide-react'

export interface CanvasIconSpec {
  Icon: LucideIcon
  fg: string
  bg: string
  /** Corner radius of the background square. Defaults to 6. */
  rx?: number
}

type RawIconNode = [string, Record<string, string | number>]

interface LucideRenderResult {
  props: { iconNode: RawIconNode[] }
}

interface LucideIconInternal {
  render: (props: object, ref: null) => LucideRenderResult
}

function getIconNodes(Icon: LucideIcon): RawIconNode[] {
  // Lucide (verified v1.17.0) captures iconNode in the forwardRef render closure. Calling
  // .render() returns a React element whose props include iconNode — the raw [tagName, attrs][]
  // SVG data. This avoids importing renderToStaticMarkup from react-dom/server on the client.
  // If icons silently stop appearing on the canvas, check whether createLucideIcon still
  // passes iconNode through the element props in the installed version.
  const el = (Icon as unknown as LucideIconInternal).render({}, null)
  const nodes = el.props.iconNode ?? []
  if (nodes.length === 0) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[lucide-to-canvas] No iconNode found — Lucide internal API may have changed.')
    }
    // Robust fallback: A generic '?' circle so the canvas doesn't crash or render blank
    return [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
      ['line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }]
    ] as RawIconNode[]
  }
  return nodes
}

function buildSvgDataUrl({ Icon, fg, bg, rx = 6 }: CanvasIconSpec): string {
  const nodes = getIconNodes(Icon)
  const inner = nodes
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')
      return `<${tag} ${attrStr}/>`
    })
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" rx="${rx}" fill="${bg}"/>` +
    `<g stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">` +
    inner +
    `</g>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function loadLucideIcon(spec: CanvasIconSpec): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = buildSvgDataUrl(spec)
  })
}
