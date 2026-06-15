'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CollectionWithTypes } from '@/types/collection'
import { formatDate } from '@/lib/utils'
import { FolderOpen } from 'lucide-react'

interface FavoriteCollectionRowProps {
  collection: CollectionWithTypes
}

export function FavoriteCollectionRow({ collection }: FavoriteCollectionRowProps) {
  const router = useRouter()
  const href = `/collections/${collection.id}`
  const dotColor = collection.dominantColor ?? '#6b7280'

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={() => router.prefetch(href)}
      className="card-interactive app-row group gap-3 rounded px-3 py-1.5 text-left touch:py-3"
    >
      <FolderOpen
        className="size-3.5 shrink-0 touch:size-5"
        style={{ color: dotColor }}
      />
      <span className="min-w-0 flex-1 truncate text-sm touch:text-base">
        {collection.name}
      </span>
      <span
        className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]"
        style={{
          color: dotColor,
          borderColor: `${dotColor}40`,
          backgroundColor: `${dotColor}10`,
        }}
      >
        collection
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDate(collection.createdAt)}
      </span>
    </Link>
  )
}
