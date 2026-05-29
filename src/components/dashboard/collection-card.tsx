'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { Star, MoreHorizontal, Edit2, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ItemTypeIcon } from '@/components/shared/item-type-icon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CollectionEditDialog } from './collection-edit-dialog'
import { CollectionDeleteDialog } from './collection-delete-dialog'
import { updateCollectionAction } from '@/actions/collections'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionCardProps {
  collection: CollectionWithTypes
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function handleFavoriteToggle() {
    const result = await updateCollectionAction(collection.id, { isFavorite: !collection.isFavorite })
    if (result.status === 'ok') {
      router.refresh()
    } else {
      toast.error('Failed to toggle favorite')
    }
  }

  return (
    <>
      <Card
        className="type-border-l relative transition-colors hover:bg-accent"
        style={{ '--item-color': collection.dominantColor ?? undefined } as CSSProperties}
      >
        <Link href={`/collections/${collection.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`View ${collection.name}`} />
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 pr-8">
            <p className="truncate font-medium">{collection.name}</p>
            {collection.isFavorite && (
              <Star className="size-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{collection.itemCount} items</p>
          {collection.description && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
              {collection.description}
            </p>
          )}
          <div className="mt-3 flex gap-1.5">
            {collection.types.map((type) => (
              <ItemTypeIcon key={type.id} iconName={type.icon} color={type.color} className="size-3.5" />
            ))}
          </div>
        </CardContent>
        
        <div className="absolute right-2 top-2 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="ghost" size="icon" className="size-8 h-8 w-8 text-muted-foreground hover:text-foreground">
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            } />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Edit2 className="mr-2 size-4" />
                Edit metadata
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFavoriteToggle}>
                <Star className={`mr-2 size-4 ${collection.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                {collection.isFavorite ? 'Remove favorite' : 'Add to favorites'}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 size-4" />
                Delete collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      <CollectionEditDialog
        collection={collection}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      
      <CollectionDeleteDialog
        collection={collection}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}
