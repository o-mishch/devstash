import type { ReactNode } from 'react'
import type { UiSkin } from '@/lib/ui-skins'
import type { DashboardData } from '@/hooks/use-dashboard'
import { ClassicSkin } from './skins/classic-skin'
import { AuroraSkin } from './skins/aurora-skin'
import { EditorialSkin } from './skins/editorial-skin'
import { SpatialSkin } from './skins/spatial-skin'
import { CommandDeckSkin } from './skins/command-deck-skin'
import { OrbitalSkin } from './skins/orbital-skin'
import { MissionControlSkin } from './skins/mission-control-skin'
import { NeonGridSkin } from './skins/neon-grid-skin'
import { HolographicSkin } from './skins/holographic-skin'

interface DashboardSkinShellProps {
  skin: UiSkin
  data: DashboardData
}

/**
 * Skin dispatcher: renders the layout component matching the resolved skin. All skins receive the
 * same resolved dashboard data; they differ only in structure/CSS. The skin is already resolved +
 * Pro-gated (see `resolveAccessibleSkin` in the route), so this only maps the value to a component.
 */
export function DashboardSkinShell({ skin, data }: DashboardSkinShellProps): ReactNode {
  if (skin === 'aurora') return <AuroraSkin {...data} />
  if (skin === 'editorial') return <EditorialSkin {...data} />
  if (skin === 'spatial') return <SpatialSkin {...data} />
  if (skin === 'command-deck') return <CommandDeckSkin {...data} />
  if (skin === 'orbital') return <OrbitalSkin {...data} />
  if (skin === 'mission-control') return <MissionControlSkin {...data} />
  if (skin === 'neon-grid') return <NeonGridSkin {...data} />
  if (skin === 'holographic') return <HolographicSkin {...data} />
  // 'classic' and the default fallback.
  return <ClassicSkin {...data} />
}
