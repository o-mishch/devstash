import Link from 'next/link'
import { FolderOpen, Star, BookMarked } from 'lucide-react'
import { StatChipBody, STAT_CHIP_CLASS, STAT_COLORS } from './stat-chip'
import { TotalItemsFanout } from './total-items-fanout'

interface StatsCardsProps {
  totalItems: number
  totalCollections: number
  favoriteItems: number
  favoriteCollections: number
}

export function StatsCards({
  totalItems,
  totalCollections,
  favoriteItems,
  favoriteCollections,
}: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
      <TotalItemsFanout totalItems={totalItems} />
      <Link href="/collections" prefetch={false} className={STAT_CHIP_CLASS}>
        <StatChipBody icon={FolderOpen} value={totalCollections} label="Collections" color={STAT_COLORS.collections} />
      </Link>
      <Link href="/favorites/items" prefetch={false} className={STAT_CHIP_CLASS}>
        <StatChipBody icon={Star} value={favoriteItems} label="Favorite Items" color={STAT_COLORS.favoriteItems} />
      </Link>
      <Link href="/favorites/collections" prefetch={false} className={STAT_CHIP_CLASS}>
        <StatChipBody icon={BookMarked} value={favoriteCollections} label="Favorite Collections" color={STAT_COLORS.favoriteCollections} />
      </Link>
    </div>
  )
}
