'use client'

import { useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyCard } from '@/components/shared/empty-card'
import { CollectionCreateDialog } from './collection-create-dialog'
import { CollectionCard } from './collection-card'
import { CollectionDialogMount } from './collection-dialog-mount'
import type { CollectionWithTypes } from '@/types/collection'
import { useCollections } from '@/hooks/items/use-collections'

type CollectionComparator = (a: CollectionWithTypes, b: CollectionWithTypes) => number

// Static — no prop/state dependency, so it's hoisted to module scope (created once ever) instead of
// re-created per render or wrapped in useMemo.
const createFirstCollectionTrigger = (
  <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
    Create your first collection <ArrowRight className="ml-2 h-4 w-4" />
  </Button>
)
const emptyStateAction = <CollectionCreateDialog trigger={createFirstCollectionTrigger} />

interface CollectionsGridProps {
  collections: CollectionWithTypes[]
}

interface CollectionsCountProps {
  initialData: CollectionWithTypes[]
}

export function CollectionsCount({ initialData }: CollectionsCountProps) {
  // Seed the shared /collections cache from SSR so the count never paints "0" on first render and
  // fires no extra GET — it reads the same cache CollectionsGrid (its sibling) seeds.
  const { collections } = useCollections({ initialData })
  const count = collections.length
  return (
    <p className="text-sm text-muted-foreground">
      {count} collection{count !== 1 ? 's' : ''}
    </p>
  )
}

export function CollectionsGrid({ collections: initialCollections }: CollectionsGridProps) {
  const searchParams = useSearchParams()
  const sort = searchParams.get('sort') || 'recent'

  const { collections } = useCollections({ initialData: initialCollections })

  if (collections.length === 0) {
    return <EmptyCard action={emptyStateAction} />
  }

  // Client-side sorting: when a secondary sort (az/za/oldest) is chosen, favorites are pinned to the
  // top and the chosen order applies within each group. The default 'recent' runs no client comparator
  // and relies on the server's `isFavorite desc, updatedAt desc` ordering to keep favorites first.
  const sortedCollections = [...collections]
  const secondarySort: Record<string, CollectionComparator> = {
    az: (a, b) => a.name.localeCompare(b.name),
    za: (a, b) => b.name.localeCompare(a.name),
    oldest: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  }
  const compare = secondarySort[sort]
  if (compare) {
    sortedCollections.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || compare(a, b))
  }

  return (
    <>
      <div className="app-grid card-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {sortedCollections.map((col) => (
          <CollectionCard key={col.id} collection={col} />
        ))}
      </div>
      <CollectionDialogMount />
    </>
  )
}
