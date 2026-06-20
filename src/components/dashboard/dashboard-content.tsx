import type { UiSkin } from '@/types/editor-preferences'
import type { DashboardSkinData } from './skins/shared'
import { ClassicSkin } from './skins/classic-skin'
import { AuroraSkin } from './skins/aurora-skin'
import { EditorialSkin } from './skins/editorial-skin'
import { SpatialSkin } from './skins/spatial-skin'
import { CommandDeckSkin } from './skins/command-deck-skin'
import { OrbitalSkin } from './skins/orbital-skin'
import { MissionControlSkin } from './skins/mission-control-skin'
import { NeonGridSkin } from './skins/neon-grid-skin'
import { HolographicSkin } from './skins/holographic-skin'

interface DashboardSkinShellProps extends DashboardSkinData {
  skin: UiSkin
}

// Skin dispatcher: renders the layout component matching the resolved skin. All skins receive the
// same scoped data promises; they differ only in structure/CSS. The skin is already resolved +
// Pro-gated server-side in page.tsx, so this just maps the value to a component.
export function DashboardSkinShell({ skin, ...data }: DashboardSkinShellProps) {
  switch (skin) {
    case 'aurora':
      return <AuroraSkin {...data} />
    case 'editorial':
      return <EditorialSkin {...data} />
    case 'spatial':
      return <SpatialSkin {...data} />
    case 'command-deck':
      return <CommandDeckSkin {...data} />
    case 'orbital':
      return <OrbitalSkin {...data} />
    case 'mission-control':
      return <MissionControlSkin {...data} />
    case 'neon-grid':
      return <NeonGridSkin {...data} />
    case 'holographic':
      return <HolographicSkin {...data} />
    case 'classic':
    default:
      return <ClassicSkin {...data} />
  }
}
