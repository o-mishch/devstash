import { notFound } from 'next/navigation'
import { getCurrentUserId } from '@/lib/session'
import { getItemTypeBySlug, getItemsByType } from '@/lib/db/items'
import { getTypeLabel } from '@/lib/utils'
import { ItemsGrid } from './_components/items-grid'

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

  const items = userId ? await getItemsByType(userId, itemType.name) : []

  const label = getTypeLabel(itemType.name)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground capitalize">{itemType.name}s</p>
      </div>

      <ItemsGrid items={items} typeName={itemType.name} />
    </div>
  )
}
