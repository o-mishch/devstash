'use client'

import { type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Star, MoreHorizontal, Edit2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api/client'
import { useCollectionDialogsStore } from '@/stores/collection-dialogs'
import { useOptimisticToggle } from '@/hooks/use-optimistic-toggle'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionCardActionsProps {
  collection: CollectionWithTypes
}

export function CollectionCardActions({ collection }: CollectionCardActionsProps) {
  const router = useRouter()
  const openEdit = useCollectionDialogsStore((s) => s.openEdit)
  const openDelete = useCollectionDialogsStore((s) => s.openDelete)
  const { value: isFavorite, toggle: toggleFavorite } = useOptimisticToggle(
    collection.isFavorite,
    async (next) => {
      const { error } = await api.PATCH('/collections/{id}/favorite', {
        params: { path: { id: collection.id } },
        body: { isFavorite: next },
      })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: () => router.refresh(),
      errorLabel: 'Failed to toggle favorite',
    }
  )

  const handleFavoriteToggle = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggleFavorite()
  }

  return (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className={`size-8 rounded-full transition-all hover:bg-transparent ${isFavorite ? 'opacity-100 text-yellow-500 hover:text-yellow-500' : 'opacity-0 group-hover/collection-card:opacity-100 touch:opacity-100 text-muted-foreground hover:text-foreground'}`}
        onClick={handleFavoriteToggle}
        title={isFavorite ? 'Remove favorite' : 'Add to favorites'}
      >
        <Star className={`size-4 ${isFavorite ? 'fill-yellow-500' : ''}`} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-transparent opacity-0 group-hover/collection-card:opacity-100 touch:opacity-100 data-[popup-open]:opacity-100 transition-all" title="More options">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        } />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(collection)}>
            <Edit2 className="mr-2 size-4" />
            Edit metadata
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleFavoriteToggle}>
            <Star className={`mr-2 size-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            {isFavorite ? 'Remove favorite' : 'Add to favorites'}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => openDelete(collection)}>
            <Trash2 className="mr-2 size-4" />
            Delete collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
