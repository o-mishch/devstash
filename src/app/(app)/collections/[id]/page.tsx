import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/session'
import { getCollectionById } from '@/lib/db/collections'
import { getItemsByCollectionPage } from '@/lib/db/items'
import { CollectionDetailHeader } from '@/components/collections/collection-detail-header'
import { CollectionItemsGrid } from '@/components/collections/collection-items-grid'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { ItemDeepLink } from '@/components/items/item-deep-link'
import CollectionLoading from './loading'

interface CollectionPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ skeleton?: string }>
}

export default async function CollectionPage({ params, searchParams }: CollectionPageProps) {
  const { id } = await params
  const forceSkeleton = (await searchParams).skeleton === 'true'
  const userId = await requireUserId()

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the auth guard and
  // before the collection read so the preview never depends on a real collection existing.
  if (forceSkeleton) return <CollectionLoading />

  const collection = await getCollectionById(userId, id)

  if (!collection) notFound()

  const mainTypeName = collection.types[0]?.name || 'mixed'
  // Honest residual (react-perf/jsx-no-jsx-as-prop): built from request-scoped `mainTypeName`, so it
  // can't be hoisted to module scope, and this file has no 'use client' directive (Server Component —
  // no useMemo available). Extracting to a local const is as far as this can honestly go.
  const itemsSkeleton = <ItemsTypeSkeleton typeName={mainTypeName} />

  return (
    <div className="app-page gap-6 p-6">
      <Suspense fallback={null}>
        <ItemDeepLink />
      </Suspense>
      <nav className="flex items-center gap-1 text-sm">
        <Link href="/collections" prefetch={false} className="text-muted-foreground hover:text-foreground transition-colors">Collections</Link>
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{collection.name}</span>
      </nav>

      <CollectionDetailHeader initialCollection={collection} />

      <Suspense fallback={itemsSkeleton}>
        <CollectionItemsFetcher collectionId={id} userId={userId} />
      </Suspense>
    </div>
  )
}

interface CollectionItemsFetcherProps {
  collectionId: string
  userId: string
}

async function CollectionItemsFetcher({ collectionId, userId }: CollectionItemsFetcherProps) {
  const firstPage = await getItemsByCollectionPage(userId, collectionId)
  return <CollectionItemsGrid collectionId={collectionId} firstPage={firstPage} />
}
