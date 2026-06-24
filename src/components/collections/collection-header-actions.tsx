'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Edit2, Trash2, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CollectionEditDialog } from '@/components/collections/collection-edit-dialog'
import { CollectionDeleteDialog } from '@/components/collections/collection-delete-dialog'
import { api } from '@/lib/api/client'
import { useOptimisticToggle } from '@/hooks/use-optimistic-toggle'
import { useInvalidateCollections } from '@/hooks/use-collections'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionHeaderActionsProps {
  collection: CollectionWithTypes
}

export function CollectionHeaderActions({ collection }: CollectionHeaderActionsProps) {
  const router = useRouter()
  const invalidateCollections = useInvalidateCollections()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Optimistic so the star flips instantly: invalidateCollections() marks the cache stale and refetches
  // in the background, so the icon never reverts while the GET /collections query settles.
  const { value: isFavorite, toggle: toggleFavorite } = useOptimisticToggle(
    collection.isFavorite,
    async (next) => {
      const { error } = await api.PATCH('/collections/{id}', {
        params: { path: { id: collection.id } },
        body: { isFavorite: next },
      })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: () => invalidateCollections(),
      errorLabel: 'Failed to toggle favorite',
    },
  )

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className={`size-8 ${isFavorite ? 'text-yellow-500 hover:text-yellow-500' : 'text-muted-foreground hover:text-foreground'}`}
        onClick={() => toggleFavorite()}
        title={isFavorite ? 'Remove favorite' : 'Add to favorites'}
      >
        <Star className={`size-4 ${isFavorite ? 'fill-yellow-500 text-yellow-500' : ''}`} />
      </Button>

      <CollectionEditDialog
        collection={collection}
        open={editOpen}
        onOpenChange={setEditOpen}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            title="Edit collection"
          >
            <Edit2 className="size-4" />
          </Button>
        }
      />

      <CollectionDeleteDialog
        collection={collection}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onSuccess={() => {
          router.push('/collections')
        }}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            title="Delete collection"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        }
      />
    </div>
  )
}
