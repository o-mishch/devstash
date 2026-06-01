'use client'

import { useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Star, MoreHorizontal, Edit2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { updateCollectionAction } from '@/actions/collections'
import { useCollectionDialogs } from './collection-dialog-provider'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionCardActionsProps {
  collection: CollectionWithTypes
}

export function CollectionCardActions({ collection }: CollectionCardActionsProps) {
  const router = useRouter()
  const { openEdit, openDelete } = useCollectionDialogs()
  const [optimisticFavorite, setOptimisticFavorite] = useState<boolean | null>(null)

  const isFavorite = optimisticFavorite ?? collection.isFavorite

  async function handleFavoriteToggle(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isFavorite
    setOptimisticFavorite(next)
    const result = await updateCollectionAction(collection.id, { isFavorite: next })
    if (result.status === 'ok') {
      router.refresh()
    } else {
      setOptimisticFavorite(!next)
      toast.error('Failed to toggle favorite')
    }
  }

  return (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className={`size-8 transition-opacity ${isFavorite ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'} ${isFavorite ? 'text-yellow-400 hover:text-yellow-400' : 'text-muted-foreground hover:text-foreground'}`}
        onClick={handleFavoriteToggle}
        title={isFavorite ? 'Remove favorite' : 'Add to favorites'}
      >
        <Star className={`size-4 ${isFavorite ? 'fill-yellow-400' : ''}`} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon" className="size-8 h-8 w-8 text-muted-foreground hover:text-foreground">
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
