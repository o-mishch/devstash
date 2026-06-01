import { CollectionCard } from './collection-card'
import type { CollectionWithTypes } from '@/types/collection'
import { CollectionDialogProvider } from './collection-dialog-provider'

interface CollectionsGridProps {
  collections: CollectionWithTypes[]
}

export function CollectionsGrid({ collections }: CollectionsGridProps) {
  return (
    <CollectionDialogProvider>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:h-full">
        {collections.map((col) => (
          <CollectionCard key={col.id} collection={col} />
        ))}
      </div>
    </CollectionDialogProvider>
  )
}
