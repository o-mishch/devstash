import { getCurrentUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { EmptyCard } from '@/components/shared/empty-card'
import { CollectionsSort } from '@/components/collections/collections-sort'
import { CollectionCreateDialog } from '@/components/collections/collection-create-dialog'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import type { CollectionWithTypes } from '@/types/collection'
import CollectionsLoading from './loading'

type CollectionComparator = (a: CollectionWithTypes, b: CollectionWithTypes) => number

interface CollectionsPageSearchParams {
  sort?: string
  skeleton?: string
}

interface CollectionsPageProps {
  searchParams: Promise<CollectionsPageSearchParams>
}

export default async function CollectionsPage({ searchParams }: CollectionsPageProps) {
  const { sort = 'recent', skeleton } = await searchParams

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows.
  if (skeleton === 'true') return <CollectionsLoading />

  const userId = await getCurrentUserId()
  const collections = userId ? await getAllCollections(userId) : []

  // Favorites stay pinned to the top in every mode; the chosen sort orders within each group.
  // 'recent' (default) needs no re-sort — getAllCollections already returns favorites-first, updatedAt desc.
  const secondarySort: Record<string, CollectionComparator> = {
    az: (a, b) => a.name.localeCompare(b.name),
    za: (a, b) => b.name.localeCompare(a.name),
    oldest: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  }
  const compare = secondarySort[sort]
  if (compare) {
    collections.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || compare(a, b))
  }

  return (
    <div className="app-page gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Collections</h1>
          <p className="text-sm text-muted-foreground">{collections.length} collection{collections.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <CollectionsSort />
        </div>
      </div>

      {collections.length === 0 ? (
        <EmptyCard
          action={
            <CollectionCreateDialog
              trigger={
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                  Create your first collection <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              }
            />
          }
        />
      ) : (
        <CollectionsGrid collections={collections} />
      )}
    </div>
  )
}
