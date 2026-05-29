'use client'

import type { CSSProperties, MouseEvent } from 'react'
import Image from 'next/image'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useItemDrawer } from '@/context/item-drawer-context'
import type { Item } from '@/types/item'

interface ImageCardProps {
  item: Item
}

export function ImageCard({ item }: ImageCardProps) {
  const { openDrawer } = useItemDrawer()

  function handleCopy(e: MouseEvent) {
    e.stopPropagation()
    navigator.clipboard
      .writeText(`${location.origin}/api/download/${item.id}`)
      .then(() => toast.success('Copied to clipboard'))
  }

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
          <div className="flex items-end justify-between">
            <p className="truncate text-sm font-medium text-white">{item.title}</p>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-white/70 opacity-0 transition-opacity hover:bg-white/20 hover:text-white group-hover/card:opacity-100"
              onClick={handleCopy}
              title="Copy link"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
