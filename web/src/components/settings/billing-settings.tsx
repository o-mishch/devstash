import type { CSSProperties, ReactNode } from 'react'
import { CreditCard, Zap } from 'lucide-react'
import { useSession } from '@/auth/session'
import { useStats } from '@/hooks/use-stats'
import { FREE_TIER_COLLECTION_LIMIT, FREE_TIER_ITEM_LIMIT } from '@/lib/limits'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Upgrade still lives on the legacy Vercel app (Stripe isn't wired into the Go backend yet).
const LEGACY_UPGRADE_URL = 'https://devstash.one/upgrade'

/**
 * Billing summary — a stub until Stripe moves to the Go backend (Backend Phase 5). It shows the
 * current plan and, for free users, live usage against the free-tier ceilings (derived from
 * /stats) with an Upgrade link out to the legacy app. Pro users see an unlimited state.
 */
export function BillingSettings(): ReactNode {
  const { data: session } = useSession()
  const stats = useStats()
  const isPro = session?.user.isPro === true

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Billing &amp; Usage</h2>
        </div>
        <Badge variant={isPro ? 'default' : 'secondary'}>{isPro ? 'Pro' : 'Free'}</Badge>
      </div>

      {isPro ? (
        <p className="text-sm text-muted-foreground">
          You’re on the Pro plan — unlimited items and collections, and every dashboard skin
          unlocked. Manage your subscription on the{' '}
          <a
            href={LEGACY_UPGRADE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            main app
          </a>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <UsageBar label="Items" used={stats.data?.totalItems} limit={FREE_TIER_ITEM_LIMIT} />
            <UsageBar
              label="Collections"
              used={stats.data?.totalCollections}
              limit={FREE_TIER_COLLECTION_LIMIT}
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Upgrade to Pro for unlimited items and collections, plus all dashboard skins.
            </p>
            <Button
              nativeButton={false}
              render={
                <a href={LEGACY_UPGRADE_URL} target="_blank" rel="noopener noreferrer">
                  <Zap className="size-4" />
                  Upgrade to Pro
                </a>
              }
            />
          </div>
        </div>
      )}
    </section>
  )
}

interface UsageBarProps {
  label: string
  used: number | undefined
  limit: number
}

// Feeds the bar's fill percentage in via a CSS var, consumed by an arbitrary-value Tailwind class
// (mirrors dashboard/stat-chip.tsx's statAccentStyle pattern).
function usageBarStyle(pct: number): CSSProperties {
  return { '--usage-pct': `${pct}%` }
}

function UsageBar({ label, used, limit }: UsageBarProps): ReactNode {
  const value = used ?? 0
  const pct = Math.min(100, Math.round((value / limit) * 100))
  const atLimit = value >= limit

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {typeof used === 'number' ? `${value} / ${limit}` : `– / ${limit}`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full w-[var(--usage-pct)] rounded-full transition-all',
            atLimit ? 'bg-destructive' : 'bg-primary',
          )}
          // oxlint-disable-next-line react/forbid-dom-props -- dynamic CSS custom property (usage percentage)
          style={usageBarStyle(pct)}
        />
      </div>
    </div>
  )
}
