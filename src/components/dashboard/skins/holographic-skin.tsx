import type { ReactNode } from 'react'
import Link from 'next/link'
import { History, Folder, Pin } from 'lucide-react'
import { DashboardRecentItems } from '@/components/dashboard/dashboard-recent-items'
import { DashboardCollectionsList } from '@/components/dashboard/dashboard-collections-list'
import { DashboardPinnedItems } from '@/components/dashboard/dashboard-pinned-items'
import { BorderBeam } from '@/components/ui/border-beam'
import { TotalItemsReveal } from '@/components/dashboard/total-items-reveal'
import { SkinCollapsibleSection } from './skin-collapsible-section'
import { computeUsage, usageLabel, resolveSkinData, type DashboardSkinData } from './shared'

interface HoloCardProps {
  children: ReactNode
  className?: string
  href?: string
}

function HoloCard({ children, className, href }: HoloCardProps) {
  const inner = <div className="ds-holo-inner rounded-[18.5px] p-[22px]">{children}</div>
  if (href) {
    return (
      <Link href={href} prefetch={false} className={`ds-holo-foil block rounded-[20px] ${className ?? ''}`}>{inner}</Link>
    )
  }
  return <div className={`ds-holo-foil rounded-[20px] ${className ?? ''}`}>{inner}</div>
}

// Holographic (Pro) — iridescent animated foil borders on glossy dark cards.
export async function HolographicSkin(data: DashboardSkinData) {
  const { isPro } = data
  const { stats, collectionStats, collections, pinned, recent } = await resolveSkinData(data)
  const usage = computeUsage(stats.totalItems, isPro)
  const hasRecent = recent.items.length > 0
  const hasPinned = pinned.length > 0

  return (
    <div>
      <header className="mb-6">
        <p className="ds-holo-text text-sm font-bold">Good to see you</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Your knowledge hub</h1>
      </header>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <HoloCard className="relative overflow-hidden">
          <div className="flex h-full flex-col justify-center p-1">
            <TotalItemsReveal variant="pop">
              <div className="text-5xl font-extrabold tracking-[-0.03em]">{stats.totalItems}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">{usageLabel(usage)}</div>
            </TotalItemsReveal>
            <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-foreground/10">
              <i className="block h-full rounded-full bg-gradient-to-r from-cyan-400 via-violet-500 to-pink-500" style={{ width: `${usage.isPro ? 100 : usage.pct}%` }} />
            </div>
          </div>
        </HoloCard>
        <HoloCard href="/collections">
          <div className="text-3xl font-extrabold">{collectionStats.totalCollections}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">Collections</div>
        </HoloCard>
        <HoloCard href="/favorites">
          <div className="text-3xl font-extrabold">{stats.favoriteItems}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">Favorites</div>
        </HoloCard>
        <HoloCard href="/collections">
          <div className="text-3xl font-extrabold">{collectionStats.favoriteCollections}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">Fav. collections</div>
        </HoloCard>
      </div>

      {hasPinned && (
        <div className="mb-4">
          <HoloCard>
            <SkinCollapsibleSection icon={<Pin />} title="Pinned">
              <DashboardPinnedItems initialItems={pinned} />
            </SkinCollapsibleSection>
          </HoloCard>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <HoloCard className="relative overflow-hidden">
          <SkinCollapsibleSection icon={<History />} title="Recent items">
            {hasRecent ? <DashboardRecentItems firstPage={recent} /> : <p className="text-sm text-muted-foreground">No items yet.</p>}
          </SkinCollapsibleSection>
          <BorderBeam size={120} duration={10} className="motion-reduce:hidden" />
        </HoloCard>
        <HoloCard>
          <SkinCollapsibleSection icon={<Folder />} title="Collections" count={collectionStats.totalCollections}>
            <DashboardCollectionsList collections={collections} />
          </SkinCollapsibleSection>
        </HoloCard>
      </div>
    </div>
  )
}
