import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { getCollectionById } from '@/lib/db/collections'
import { getItemsByCollection } from '@/lib/db/items'
import { ItemCard } from '@/components/items/item-card'
import { ImageCard } from '@/components/items/image-card'
import { FileRow } from '@/components/items/file-row'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'
import type { Item } from '@/types/item'

interface CollectionPageProps {
  params: Promise<{ id: string }>
}

interface CollectionItemsGridProps {
  items: Item[]
}

function CollectionItemsGrid({ items }: CollectionItemsGridProps) {
  if (items.length === 0) {
    return (
      <Card className="h-20">
        <CardContent className="flex h-full items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">No items in this collection yet.</p>
        </CardContent>
      </Card>
    )
  }

  const uniqueTypeCount = new Set(items.map((i) => i.itemType.name)).size

  if (uniqueTypeCount === 1) {
    const typeName = items[0].itemType.name

    if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) {
      return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {items.map((item, index) => (
            <ImageCard key={item.id} item={item} priority={index < 6} />
          ))}
        </div>
      )
    }

    if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) {
      return (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <FileRow key={item.id} item={item} />
          ))}
        </div>
      )
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        if (ITEM_TYPES_WITH_IMAGE_GRID.has(item.itemType.name)) {
          return <ImageCard key={item.id} item={item} />
        }
        return <ItemCard key={item.id} item={item} />
      })}
    </div>
  )
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { id } = await params
  const userId = await getCurrentUserId()

  if (!userId) notFound()

  const [collection, items] = await Promise.all([
    getCollectionById(userId, id),
    getItemsByCollection(userId, id),
  ])

  if (!collection) notFound()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/collections" className="hover:text-foreground transition-colors">Collections</Link>
          <ChevronRight className="size-3" />
          <span className="text-foreground">{collection.name}</span>
        </nav>
        <h1 className="text-xl font-semibold">{collection.name}</h1>
        {collection.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{collection.description}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</p>
      </div>

      <CollectionItemsGrid items={items} />
    </div>
  )
}
