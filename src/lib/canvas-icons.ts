import { ICON_MAP } from '@/components/shared/item-type-icon'
import { SYSTEM_TYPE_ORDER, SYSTEM_TYPE_COLORS, SYSTEM_TYPE_ICON_NAMES } from '@/lib/utils/constants'
import { loadLucideIcon } from './lucide-to-canvas'

import githubSvg from '@/assets/icons/canvas/github.svg'
import vscodeSvg from '@/assets/icons/canvas/vscode.svg'
import typescriptSvg from '@/assets/icons/canvas/typescript.svg'
import vercelSvg from '@/assets/icons/canvas/vercel.svg'
import slackSvg from '@/assets/icons/canvas/slack.svg'
import figmaSvg from '@/assets/icons/canvas/figma.svg'
import dockerSvg from '@/assets/icons/canvas/docker.svg'

const DEV_TOOL_SVGS = [
  githubSvg,
  vscodeSvg,
  typescriptSvg,
  vercelSvg,
  slackSvg,
  figmaSvg,
  dockerSvg,
]

function loadSvgIcon(rawSvg: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rawSvg)}`
  })
}

function loadItemTypeIcons(): Promise<Array<HTMLImageElement | null>> {
  return Promise.all(
    SYSTEM_TYPE_ORDER
      .filter(name => ICON_MAP[SYSTEM_TYPE_ICON_NAMES[name]] !== undefined)
      .map(name => {
        const bg = SYSTEM_TYPE_COLORS[name]
        const fg = name === 'note' ? '#1c1917' : '#fff'
        return loadLucideIcon({ Icon: ICON_MAP[SYSTEM_TYPE_ICON_NAMES[name]], fg, bg })
      }),
  )
}

export async function loadCanvasIcons(): Promise<HTMLImageElement[]> {
  const [devTools, itemTypes] = await Promise.all([
    Promise.all(DEV_TOOL_SVGS.map(loadSvgIcon)),
    loadItemTypeIcons(),
  ])
  return [...devTools, ...itemTypes].filter((img): img is HTMLImageElement => img !== null)
}
