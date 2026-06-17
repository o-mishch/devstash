'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface FavoritesTabNavProps {
  itemCount: number
  collectionCount: number
}

interface FavoritesTab {
  href: string
  label: string
  count: number
}

export function FavoritesTabNav({ itemCount, collectionCount }: FavoritesTabNavProps) {
  const pathname = usePathname()
  const tabs: FavoritesTab[] = [
    { href: '/favorites/items', label: 'Items', count: itemCount },
    { href: '/favorites/collections', label: 'Collections', count: collectionCount },
  ]

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href
        const stateClass = active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${stateClass}`}
          >
            {tab.label}
            <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-xs tabular-nums">{tab.count}</span>
          </Link>
        )
      })}
    </div>
  )
}
