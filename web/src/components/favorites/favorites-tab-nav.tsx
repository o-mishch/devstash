import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FavoritesTab } from '@/lib/favorites-tab'
import { FAVORITES_TABS, FAVORITES_TAB_LABELS } from '@/lib/favorites-tab'

interface FavoritesTabNavProps {
  active: FavoritesTab
  counts: Record<FavoritesTab, number | undefined>
  onChange: (tab: FavoritesTab) => void
}

/** Segmented Items | Collections pill with per-tab counts, mirroring the legacy favorites nav. */
export function FavoritesTabNav({ active, counts, onChange }: FavoritesTabNavProps): ReactNode {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {FAVORITES_TABS.map((tab) => {
        const isActive = tab === active
        const count = counts[tab]
        return (
          <button
            key={tab}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {FAVORITES_TAB_LABELS[tab]}
            {typeof count === 'number' && (
              <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-xs tabular-nums">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
