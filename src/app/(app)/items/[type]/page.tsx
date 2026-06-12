import { notFound } from 'next/navigation'
import { getItemTypeBySlug } from '@/lib/db/items'
import { getTypeLabel } from '@/lib/utils'
import { ItemsGrid } from '@/components/items/items-grid'

interface ItemsPageProps {
  params: Promise<{ type: string }>
}

export default async function ItemsPage({ params }: ItemsPageProps) {
  const { type: typeSlug } = await params

  const itemType = await getItemTypeBySlug(typeSlug)
  if (!itemType) notFound()

  return (
    <div className="app-page gap-6 p-6">
      <ItemsGrid typeName={itemType.name} typeLabel={getTypeLabel(itemType.name)} />
    </div>
  )
}
