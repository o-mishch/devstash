import type { ReactNode } from 'react'
import type { CollectionWithTypes } from '@/client'
import { CollectionsGrid } from '@/components/collections/collections-grid'

interface SkinCollectionsGridProps {
  collections: CollectionWithTypes[]
}

/**
 * Thin wrapper letting the skins render the shared collections grid with the legacy
 * `<CollectionsGrid collections={…} />` call shape. The data is already resolved by the time a skin
 * renders (the route gates loading), so pending/error are false here.
 */
export function SkinCollectionsGrid({ collections }: SkinCollectionsGridProps): ReactNode {
  return (
    <CollectionsGrid
      data={collections}
      isPending={false}
      isError={false}
      emptyDescription="Group related items into collections to keep things tidy."
    />
  )
}
