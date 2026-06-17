import { CollectionCard } from './collection-card'
import { CollectionDialogMount } from './collection-dialog-mount'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionsGridProps {
  collections: CollectionWithTypes[]
}

export function CollectionsGrid({ collections }: CollectionsGridProps) {
  return (
    <>
      <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {collections.map((col) => (
          <CollectionCard key={col.id} collection={col} />
        ))}
      </div>
      <CollectionDialogMount />
    </>
  )
}
