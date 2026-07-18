import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, FolderOpen, Inbox } from 'lucide-react'
import { itemCount, useItemsInfinite } from '@/hooks/use-items'
import { useCollection } from '@/hooks/use-collections'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState } from '@/components/app/empty-state'
import { ItemList } from '@/components/items/item-list'

export const Route = createFileRoute('/_app/collections/$id')({
  component: CollectionDetail,
})

function CollectionDetail(): ReactNode {
  const { id } = Route.useParams()
  const collection = useCollection(id)
  const items = useItemsInfinite({ type: 'collection', collectionId: id })
  const meta = collection.data

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/collections"
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        All collections
      </Link>

      {/* Only a 404 reaches `isError` — `useCollection` throws every other failure to the
          route's errorComponent — so this claim of "not found" is always the truth. */}
      {collection.isError ? (
        <EmptyState
          icon={FolderOpen}
          title="Collection not found"
          description="It may have been deleted, or the link is no longer valid."
        />
      ) : (
        <>
          <PageHeader
            icon={FolderOpen}
            title={meta?.name ?? (collection.isPending ? 'Loading…' : 'Collection')}
            count={itemCount(items)}
            description={meta?.description ?? undefined}
          />

          <ItemList
            query={items}
            empty={{
              icon: Inbox,
              title: 'This collection is empty',
              description: 'Items you add to this collection will appear here.',
            }}
          />
        </>
      )}
    </div>
  )
}
