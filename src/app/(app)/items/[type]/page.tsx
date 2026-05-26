export const revalidate = 60

import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getCurrentUserId } from '@/lib/db/collections'
import { getItemTypeBySlug } from '@/lib/db/items'
import { ItemsGrid } from './_components/items-grid'
import { ItemsGridSkeleton } from './_components/items-grid-skeleton'

interface ItemsPageProps {
  params: Promise<{ type: string }>
}

export default async function ItemsPage({ params }: ItemsPageProps) {
  const { type: typeSlug } = await params

  const [itemType, userId] = await Promise.all([
    getItemTypeBySlug(typeSlug),
    getCurrentUserId(),
  ])

  if (!itemType) notFound()

  const label = itemType.name.charAt(0).toUpperCase() + itemType.name.slice(1) + 's'

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground capitalize">{itemType.name}s</p>
      </div>

      <Suspense fallback={<ItemsGridSkeleton />}>
        {userId ? (
          <ItemsGrid userId={userId} typeName={itemType.name} />
        ) : (
          null
        )}
      </Suspense>
    </div>
  )
}
