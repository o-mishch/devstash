import Link from 'next/link'
import { FolderOpen, Star, BookMarked } from 'lucide-react'
import { StatChipBody, statAccentStyle, STAT_CHIP_CLASS, STAT_COLORS } from './stat-chip'
import { TotalItemsFanout } from './total-items-fanout'
import { BrainDumpWidget } from './brain-dump-widget'

// The stats row grid track. Shared with `StatsCardsSkeleton` so the loading and loaded layouts stay
// pixel-identical. Pro drops the Favorite Collections chip and adds a wide Brain Dump cell (5-col track);
// free keeps the balanced 4-up.
export function statsCardsGridClass(isPro: boolean): string {
  return isPro
    ? 'grid grid-cols-2 items-stretch gap-2 sm:grid-cols-5 sm:gap-3'
    : 'grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3'
}

interface StatsCardsProps {
  totalItems: number
  totalCollections: number
  favoriteItems: number
  favoriteCollections: number
  // Pro users get the Brain Dump action in place of the Favorite Collections chip — the row stays a
  // single line (no extra banner). Free users keep all four stat chips.
  isPro: boolean
}

export function StatsCards({
  totalItems,
  totalCollections,
  favoriteItems,
  favoriteCollections,
  isPro,
}: StatsCardsProps) {
  return (
    <div className={statsCardsGridClass(isPro)}>
      <TotalItemsFanout totalItems={totalItems} />
      <Link href="/collections" prefetch={false} className={STAT_CHIP_CLASS} style={statAccentStyle(STAT_COLORS.collections)}>
        <StatChipBody icon={FolderOpen} value={totalCollections} label="Collections" color={STAT_COLORS.collections} />
      </Link>
      {/* Favorite Items chip is hidden on mobile to keep the stat strip to a tight two-up (+ Brain Dump). */}
      <Link href="/favorites/items" prefetch={false} className={`${STAT_CHIP_CLASS} max-sm:hidden`} style={statAccentStyle(STAT_COLORS.favoriteItems)}>
        <StatChipBody icon={Star} value={favoriteItems} label="Favorite Items" color={STAT_COLORS.favoriteItems} />
      </Link>
      {isPro ? (
        <BrainDumpWidget skin="classic" className="col-span-2" />
      ) : (
        <Link href="/favorites/collections" prefetch={false} className={STAT_CHIP_CLASS} style={statAccentStyle(STAT_COLORS.favoriteCollections)}>
          <StatChipBody icon={BookMarked} value={favoriteCollections} label="Favorite Collections" color={STAT_COLORS.favoriteCollections} />
        </Link>
      )}
    </div>
  )
}
