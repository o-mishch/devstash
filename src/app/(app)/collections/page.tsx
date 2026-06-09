import { getCurrentUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { EmptyCard } from '@/components/shared/empty-card'
import { CollectionsSort } from '@/components/collections/collections-sort'
import { CollectionCreateDialog } from '@/components/dashboard/collection-create-dialog'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

interface CollectionsPageSearchParams {
  sort?: string
}

interface CollectionsPageProps {
  searchParams: Promise<CollectionsPageSearchParams>
}

export default async function CollectionsPage({ searchParams }: CollectionsPageProps) {
  const userId = await getCurrentUserId()
  const collections = userId ? await getAllCollections(userId) : []
  
  const { sort = 'recent' } = await searchParams

  if (sort === 'az') {
    collections.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === 'za') {
    collections.sort((a, b) => b.name.localeCompare(a.name))
  } else if (sort === 'oldest') {
    collections.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }
  // 'recent' (default): getAllCollections already orders by updatedAt desc at the DB level

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
