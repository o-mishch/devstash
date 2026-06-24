import { requireUserId } from '@/lib/session'
import { getAllCollections } from '@/lib/db/collections'
import { CollectionsGrid, CollectionsCount } from '@/components/collections/collections-grid'
import { CollectionsSort } from '@/components/collections/collections-sort'
import CollectionsLoading from './loading'

interface CollectionsPageSearchParams {
  sort?: string
  skeleton?: string
}

interface CollectionsPageProps {
  searchParams: Promise<CollectionsPageSearchParams>
}

export default async function CollectionsPage({ searchParams }: CollectionsPageProps) {
  const userId = await requireUserId()
  const { skeleton } = await searchParams

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the auth guard.
  if (skeleton === 'true') return <CollectionsLoading />

  const collections = await getAllCollections(userId)

  return (
    <div className="app-page gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Collections</h1>
          <CollectionsCount initialData={collections} />
        </div>
        <div className="flex items-center gap-3">
          <CollectionsSort />
        </div>
      </div>

      <CollectionsGrid collections={collections} />
    </div>
  )
}
