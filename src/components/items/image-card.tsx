'use client'

import type { CSSProperties } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { useItemDrawer } from '@/context/item-drawer-context'
import type { Item } from '@/types/item'

interface ImageCardProps {
  item: Item
}

export function ImageCard({ item }: ImageCardProps) {
  const { openDrawer } = useItemDrawer()

  return (
    <Card
      className="group/card relative cursor-pointer overflow-hidden transition-colors hover:bg-accent"
      style={{ '--item-color': item.itemType.color } as CSSProperties}
      onClick={() => openDrawer(item.id)}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        <Image
          src={`/api/download/${item.id}`}
          alt={item.title}
          fill
          unoptimized
          className="object-cover transition-transform duration-300 group-hover/card:scale-105"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-12">
          <p className="truncate text-sm font-medium text-white">{item.title}</p>
        </div>
      </div>
    </Card>
  )
}
