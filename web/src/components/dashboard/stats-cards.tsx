import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BookMarked, FolderOpen, Library, Star } from 'lucide-react'
import { StatChipBody, statAccentStyle, STAT_CHIP_CLASS, STAT_COLORS } from './stat-chip'
import { TotalItemsReveal } from './total-items-reveal'

interface StatsCardsProps {
  totalItems: number
  totalCollections: number
  favoriteItems: number
  favoriteCollections: number
}

/**
 * The dashboard stat strip: a balanced four-up of clickable chips. There is no single "all items"
 * route, so the Total Items chip opens the browse-by-type reveal (matching the other skins) instead
 * of deep-linking; the other three deep-link to their list. Brain Dump lives in the sidebar (Phase 6
 * stub), so — unlike the legacy Pro layout — the strip is the same four chips for free and Pro users.
 */
export function StatsCards({
  totalItems,
  totalCollections,
  favoriteItems,
  favoriteCollections,
}: StatsCardsProps): ReactNode {
  return (
    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
      <TotalItemsReveal
        variant="pop"
        className={STAT_CHIP_CLASS}
        // oxlint-disable-next-line react/forbid-component-props -- data-driven accent color
        style={statAccentStyle(STAT_COLORS.total)}
      >
        <StatChipBody
          icon={Library}
          value={totalItems}
          label="Total Items"
          color={STAT_COLORS.total}
        />
      </TotalItemsReveal>
      <Link
        to="/collections"
        className={STAT_CHIP_CLASS}
        // oxlint-disable-next-line react/forbid-component-props -- data-driven accent color
        style={statAccentStyle(STAT_COLORS.collections)}
      >
        <StatChipBody
          icon={FolderOpen}
          value={totalCollections}
          label="Collections"
          color={STAT_COLORS.collections}
        />
      </Link>
      <Link
        to="/favorites"
        search={{ tab: 'items' }}
        className={STAT_CHIP_CLASS}
        // oxlint-disable-next-line react/forbid-component-props -- data-driven accent color
        style={statAccentStyle(STAT_COLORS.favoriteItems)}
      >
        <StatChipBody
          icon={Star}
          value={favoriteItems}
          label="Favorite Items"
          color={STAT_COLORS.favoriteItems}
        />
      </Link>
      <Link
        to="/favorites"
        search={{ tab: 'collections' }}
        className={STAT_CHIP_CLASS}
        // oxlint-disable-next-line react/forbid-component-props -- data-driven accent color
        style={statAccentStyle(STAT_COLORS.favoriteCollections)}
      >
        <StatChipBody
          icon={BookMarked}
          value={favoriteCollections}
          label="Favorite Collections"
          color={STAT_COLORS.favoriteCollections}
        />
      </Link>
    </div>
  )
}
