import type { ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import type { CollectionWithTypes } from '@/client'
import { EmptyState } from '@/components/app/empty-state'
import { CardGridStates } from '@/components/app/grid-states'
import { CollectionCard } from './collection-card'

interface CollectionsGridProps {
  data: CollectionWithTypes[] | null | undefined
  isPending: boolean
  isError: boolean
  emptyDescription: string
  skeletonCount?: number
}

/** Four-state collections grid (loading → error → empty → cards). Shared by the
 *  dashboard's "Collections" section and the `/collections` index. */
export function CollectionsGrid({
  data,
  isPending,
  isError,
  emptyDescription,
  skeletonCount = 6,
}: CollectionsGridProps): ReactNode {
  const list = data ?? []

  return (
    <CardGridStates
      isPending={isPending}
      isError={isError}
      errorLabel="collections"
      isEmpty={list.length === 0}
      emptyState={
        <EmptyState icon={FolderOpen} title="No collections yet" description={emptyDescription} />
      }
      tileClassName="h-28"
      skeletonCount={skeletonCount}
    >
      {list.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} />
      ))}
    </CardGridStates>
  )
}
