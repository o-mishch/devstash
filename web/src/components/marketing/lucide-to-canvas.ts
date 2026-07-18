import type { LucideIcon } from 'lucide-react'
import svgToMiniDataURI from 'mini-svg-data-uri'
import { loadImageFromDataUrl } from './image-loader'

export interface CanvasIconSpec {
  Icon: LucideIcon
  fg: string
  bg: string
  /** Corner radius of the background square. Defaults to 6. */
  rx?: number
}

type RawIconNode = [string, Record<string, string | number>]

interface LucideRenderResult {
  props: { iconNode?: RawIconNode[] }
}

interface LucideIconInternal {
  render: (props: object, ref: null) => LucideRenderResult
}

function getIconNodes(Icon: LucideIcon): RawIconNode[] {
  // Genuinely inherent boundary with no honest alternative: Lucide doesn't expose raw SVG nodes.
  // We double-cast to access the internal render API of Lucide, which is permitted with a comment.
  /* oxlint-disable-next-line typescript/no-unsafe-type-assertion */
  const el = (Icon as unknown as LucideIconInternal).render({}, null)
  const nodes = el.props.iconNode ?? []
  if (nodes.length > 0) {
    return nodes
  }

  // Robust fallback if Lucide's internal API ever changes: a generic '?' circle so the canvas
  // doesn't crash or render blank (the placeholder icon makes the drift visible on its own).
  return [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }],
  ] as RawIconNode[]
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="${rx}" fill="${bg}"/><g stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${inner}</g></svg>`
  return svgToMiniDataURI(svg)
}

export async function loadLucideIcon(spec: CanvasIconSpec): Promise<HTMLImageElement | null> {
  return loadImageFromDataUrl(buildSvgDataUrl(spec))
}
