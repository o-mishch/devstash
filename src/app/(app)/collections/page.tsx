import { getCurrentUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { EmptyCard } from '@/components/shared/empty-card'
import { CollectionsSort } from './_components/collections-sort'

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
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
    <div className="flex flex-col gap-6 p-6">
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
        <EmptyCard message="No collections yet." />
      ) : (
        <CollectionsGrid collections={collections} />
      )}
    </div>
  )
}
