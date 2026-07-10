'use client'

import { memo, useCallback, useMemo, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CollectionWithTypes } from '@/types/collection'
import { formatDate } from '@/lib/utils'
import { FolderOpen } from 'lucide-react'

interface FavoriteCollectionRowProps {
  collection: CollectionWithTypes
}

export const FavoriteCollectionRow = memo(function FavoriteCollectionRow({ collection }: FavoriteCollectionRowProps) {
  const router = useRouter()
  const href = `/collections/${collection.id}`
  const dotColor = collection.dominantColor ?? '#6b7280'

  const handleMouseEnter = useCallback(() => {
    router.prefetch(href)
  }, [router, href])

  const style = useMemo(() => ({ '--item-color': dotColor } as CSSProperties), [dotColor])
  const folderStyle = useMemo(() => ({ color: dotColor }), [dotColor])
  const badgeStyle = useMemo(() => ({
    color: dotColor,
    borderColor: `${dotColor}40`,
    backgroundColor: `${dotColor}10`,
  }), [dotColor])

  // Same card family as the dashboard item rows: rounded-xl, left accent border, subtle ring,
  // bg-card, hover-lift.
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={handleMouseEnter}
      className="card-interactive app-row group gap-3 rounded-xl border-l-2 border-l-[var(--item-color)] bg-card px-3 py-2 text-left ring-1 ring-border touch:py-3"
      style={style}
    >
      <FolderOpen
        className="size-3.5 shrink-0 touch:size-5"
        style={folderStyle}
      />
      <span className="min-w-0 flex-1 truncate text-sm touch:text-base">
        {collection.name}
      </span>
      <span
        className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]"
        style={badgeStyle}
      >
        collection
      </span>
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
        {formatDate(collection.createdAt)}
      </span>
    </Link>
  )
})
