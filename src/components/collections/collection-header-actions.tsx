'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Edit2, Trash2, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CollectionEditDialog } from '@/components/dashboard/collection-edit-dialog'
import { CollectionDeleteDialog } from '@/components/dashboard/collection-delete-dialog'
import { patch } from '@/lib/api/api-fetch'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionHeaderActionsProps {
  collection: CollectionWithTypes
}

export function CollectionHeaderActions({ collection }: CollectionHeaderActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function handleFavoriteToggle() {
    const result = await patch(`/api/collections/${collection.id}`, { isFavorite: !collection.isFavorite })
    if (result.status === 'ok') {
      router.refresh()
    } else {
      toast.error('Failed to toggle favorite')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-foreground"
        onClick={handleFavoriteToggle}
        title={collection.isFavorite ? 'Remove favorite' : 'Add to favorites'}
      >
        <Star className={`size-4 ${collection.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
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
            <Trash2 className="size-4" />
          </Button>
        }
      />
    </div>
  )
}
