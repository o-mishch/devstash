import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useDashboardData } from '@/hooks/use-dashboard'
import { useEditorPreferences } from '@/hooks/use-preferences'
import { normalizeUiSkin } from '@/lib/theme'
import { resolveAccessibleSkin } from '@/lib/ui-skins'
import { DashboardSkinShell } from '@/components/dashboard/dashboard-content'
import { DashboardError, DashboardSkeleton } from '@/components/dashboard/dashboard-skeletons'

export const Route = createFileRoute('/_app/dashboard')({
  component: Dashboard,
})

function Dashboard(): ReactNode {
  const data = useDashboardData()
  const { data: prefs } = useEditorPreferences()

  // The stored skin is Pro-gated client-side for an immediate render; the server is authoritative
  // (the Go `me` package resolves the same fallback). `data-skin` lets skin CSS scope to the tree.
  const skin = resolveAccessibleSkin(normalizeUiSkin(prefs?.uiSkin), data.isPro)

  // Gate the whole skin on the core data so a skin never has to render a half-loaded state — every
  // skin can then read `data.totalItems` / `data.recent` as ready values.
  return (
    <div data-skin={skin} className="flex flex-col gap-6">
      <DashboardContent skin={skin} data={data} />
    </div>
  )
}

interface DashboardContentProps {
  skin: ReturnType<typeof resolveAccessibleSkin>
  data: ReturnType<typeof useDashboardData>
}

function DashboardContent({ skin, data }: DashboardContentProps): ReactNode {
  if (data.isError) return <DashboardError />
  if (data.isPending) return <DashboardSkeleton />
  return <DashboardSkinShell skin={skin} data={data} />
}
