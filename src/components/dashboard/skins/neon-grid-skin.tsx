import Link from 'next/link'
import { History, Folder, Pin } from 'lucide-react'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { RetroGrid } from '@/components/ui/retro-grid'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, resolveSkinData, TypeDistributionSegments, type DashboardSkinData } from './shared'

const NEON_CELL = 'rounded-lg border bg-[color-mix(in_srgb,var(--card)_60%,transparent)] p-5 backdrop-blur'
const NEON_PANEL = 'relative z-10 rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--card)_55%,transparent)] p-5 backdrop-blur'

// Neon Grid (Pro) — synthwave neon outlines over an animated perspective grid horizon.
export async function NeonGridSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent, distribution } =
    await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  const cells = [
    { value: String(stats.totalItems), label: 'total items', color: 'var(--primary)', href: undefined as string | undefined },
    { value: String(collectionStats.totalCollections).padStart(2, '0'), label: 'collections', color: '#ec4899', href: '/collections' },
    { value: String(stats.favoriteItems).padStart(2, '0'), label: 'favorites', color: '#8b5cf6', href: '/favorites' },
    { value: String(collectionStats.favoriteCollections).padStart(2, '0'), label: 'fav. collections', color: '#a78bfa', href: '/collections' },
    { value: usage.isPro ? '∞' : String(usage.slotsLeft), label: usage.isPro ? 'unlimited' : 'slots left', color: '#22d3ee', href: undefined as string | undefined },
  ]

  return (
    <div className="relative min-h-[70vh]">
      <RetroGrid className="inset-x-0 bottom-0 top-auto h-[45vh]" opacity={0.35} angle={65} />
      <div className="relative z-10">
        <header className="mb-6">
          <p className="font-mono text-[13px] text-primary">{'// knowledge.exe running'}</p>
          <h1 className="mt-1 font-mono text-2xl font-extrabold tracking-[0.06em] sm:text-3xl [text-shadow:0_0_18px_color-mix(in_srgb,var(--primary)_60%,transparent)]">
            DASHBOARD
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{stats.totalItems} records indexed · grid online</p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {cells.map((c) => {
            const style = { borderColor: c.color, boxShadow: `0 0 24px -6px ${c.color}, inset 0 0 24px -14px ${c.color}` }
            const inner = (
              <>
                <div className="font-mono text-3xl font-extrabold">{c.value}</div>
                <div className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{c.label}</div>
              </>
            )
            if (c.href) {
              return <Link key={c.label} href={c.href} prefetch={false} className={`${NEON_CELL} block transition-transform hover:-translate-y-0.5`} style={style}>{inner}</Link>
            }
            if (c.label === 'total items') {
              return (
                <div key={c.label} className={NEON_CELL} style={style}>
                  <TotalItemsReveal variant="neon" className="block w-full">{inner}</TotalItemsReveal>
                </div>
              )
            }
            return <div key={c.label} className={NEON_CELL} style={style}>{inner}</div>
          })}
        </div>

        {hasPinned && (
          <div className={`${NEON_PANEL} mb-4`}>
            <SkinCollapsibleSection icon={<Pin />} title="Pinned" headerClassName="font-mono tracking-[0.1em] text-primary">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinCollapsibleSection>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <div className={NEON_PANEL}>
            <SkinCollapsibleSection title="Recent records" headerClassName="font-mono tracking-[0.1em] text-primary">
              {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
            </SkinCollapsibleSection>
          </div>
          <div className={NEON_PANEL}>
            <SkinCollapsibleSection icon={<Folder />} title="Collections" headerClassName="font-mono tracking-[0.1em] text-primary">
              <DashboardCollectionsList collections={collections} />
            </SkinCollapsibleSection>
            <div className="mt-5">
              <SkinCollapsibleSection icon={<History />} title="Distribution" headerClassName="font-mono tracking-[0.1em] text-primary">
                <TypeDistributionSegments distribution={distribution} />
              </SkinCollapsibleSection>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
