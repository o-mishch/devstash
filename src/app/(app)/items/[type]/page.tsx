import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getTypeLabel, slugToTypeName } from '@/lib/utils'
import { SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'
import { ItemsGrid } from '@/components/items/items-grid'
import { ItemDeepLink } from '@/components/items/item-deep-link'

interface ItemsPageProps {
  params: Promise<{ type: string }>
}

export default async function ItemsPage({ params }: ItemsPageProps) {
  const { type: typeSlug } = await params

  // Item types are a fixed, immutable system set — validate the slug against the
  // constant instead of a per-navigation DB lookup.
  const typeName = slugToTypeName(typeSlug)
  if (!SYSTEM_TYPE_ORDER.includes(typeName)) notFound()

  return (
    <div className="app-page gap-6 p-6">
      <Suspense fallback={null}>
        <ItemDeepLink />
      </Suspense>
      <ItemsGrid typeName={typeName} typeLabel={getTypeLabel(typeName)} />
    </div>
  )
}
