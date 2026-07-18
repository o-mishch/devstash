import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { useCollections } from '@/hooks/use-collections'
import {
  DEFAULT_COLLECTION_SORT,
  collectionSortSchema,
  sortCollections,
} from '@/lib/collection-sort'
import { PageHeader } from '@/components/app/page-header'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { CollectionsSort } from '@/components/collections/collections-sort'

export const Route = createFileRoute('/_app/collections/')({
  validateSearch: collectionSortSchema,
  component: Collections,
})

function Collections(): ReactNode {
  const { sort = DEFAULT_COLLECTION_SORT } = Route.useSearch()
  const navigate = Route.useNavigate()
  const collections = useCollections()

  const sorted = collections.data && sortCollections(collections.data, sort)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FolderOpen}
        title="Collections"
        // undefined while pending AND on error — showing nothing beats showing "0" for a
        // request that failed rather than came back empty (matches `itemCount`'s policy).
        count={collections.data?.length}
        description="Group related items to keep your stash organized."
        actions={
          <CollectionsSort
            value={sort}
            onChange={(next) => void navigate({ search: { sort: next }, replace: true })}
          />
        }
      />

      <CollectionsGrid
        data={sorted}
        isPending={collections.isPending}
        isError={collections.isError}
        emptyDescription="Create a collection to group related snippets, prompts and notes."
      />
    </div>
  )
}
