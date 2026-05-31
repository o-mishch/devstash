import { getCurrentUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { EmptyCard } from '@/components/shared/empty-card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default async function CollectionsPage() {
  const userId = await getCurrentUserId()
  const collections = userId ? await getAllCollections(userId) : []

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Collections</h1>
          <p className="text-sm text-muted-foreground">{collections.length} collection{collections.length !== 1 ? 's' : ''}</p>
        </div>
        <CollectionCreateDialog
          trigger={<Button size="sm"><Plus className="size-4 mr-1" /> New Collection</Button>}
        />
      </div>

      {collections.length === 0 ? (
        <EmptyCard message="No collections yet." />
      ) : (
        <CollectionsGrid collections={collections} />
      )}
    </div>
  )
}
