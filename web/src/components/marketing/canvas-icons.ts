import { loadLucideIcon } from '@/components/marketing/lucide-to-canvas'
import { ITEM_TYPES } from '@/lib/item-types'
import svgToMiniDataURI from 'mini-svg-data-uri'
import { loadImageFromDataUrl } from './image-loader'

import githubSvg from '@/assets/icons/github.svg?raw'
import vscodeSvg from '@/assets/icons/vscode.svg?raw'
import typescriptSvg from '@/assets/icons/typescript.svg?raw'
import slackSvg from '@/assets/icons/slack.svg?raw'
import figmaSvg from '@/assets/icons/figma.svg?raw'
import dockerSvg from '@/assets/icons/docker.svg?raw'
import googleSvg from '@/assets/icons/google.svg?raw'

const DEV_TOOL_SVGS = [
  githubSvg,
  vscodeSvg,
  typescriptSvg,
  slackSvg,
  figmaSvg,
  dockerSvg,
  googleSvg,
]

async function loadSvgIcon(rawSvg: string): Promise<HTMLImageElement | null> {
  return loadImageFromDataUrl(svgToMiniDataURI(rawSvg))
}

// Icon + color come from the single ITEM_TYPES source of truth (its `.hex` accent).
async function loadItemTypeIcons(): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(
    ITEM_TYPES.map(async ({ name, icon, hex }) => {
      const fg = name === 'note' ? '#1c1917' : '#fff'
      return loadLucideIcon({ Icon: icon, fg, bg: hex })
    }),
  )
}

export async function loadCanvasIcons(): Promise<HTMLImageElement[]> {
  const [devTools, itemTypes] = await Promise.all([
    Promise.all(DEV_TOOL_SVGS.map(async (svg) => loadSvgIcon(svg))),
    loadItemTypeIcons(),
  ])
  return [...devTools, ...itemTypes].filter((img): img is HTMLImageElement => img !== null)
}
