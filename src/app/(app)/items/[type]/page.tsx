import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getTypeLabel, slugToTypeName } from '@/lib/utils'
import { SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { ItemsGrid } from '@/components/items/items-grid'
import { ItemDeepLink } from '@/components/items/item-deep-link'

interface ItemsPageProps {
  params: Promise<{ type: string }>
  searchParams: Promise<{ skeleton?: string }>
}

export default async function ItemsPage({ params, searchParams }: ItemsPageProps) {
  const { type: typeSlug } = await params

  // Item types are a fixed, immutable system set — validate the slug against the
  // constant instead of a per-navigation DB lookup.
  const typeName = slugToTypeName(typeSlug)
  if (!SYSTEM_TYPE_ORDER.includes(typeName)) notFound()

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the slug guard.
  if ((await searchParams).skeleton === 'true') {
    return (
      <div className="app-page gap-6 p-6">
        <div className="text-xl font-semibold">
          <Skeleton className="h-7 w-48" />
        </div>
        <ItemsTypeSkeleton typeName={typeName} />
      </div>
    )
  }

  return (
    <div className="app-page gap-6 p-6">
      <Suspense fallback={null}>
        <ItemDeepLink />
      </Suspense>
      <ItemsGrid typeName={typeName} typeLabel={getTypeLabel(typeName)} />
    </div>
  )
}
