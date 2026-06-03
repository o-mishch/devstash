import { notFound } from 'next/navigation'
import { getCurrentUserId } from '@/lib/session'
import { getItemTypeBySlug, getItemsByTypePage } from '@/lib/db/items'
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

  const emptyPage = { items: [], nextCursor: null, hasMore: false }
  const firstPage = userId
    ? await getItemsByTypePage(userId, itemType.name)
    : emptyPage

  const label = getTypeLabel(itemType.name)

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">{label}</h1>
      <ItemsGrid firstPage={firstPage} typeName={itemType.name} />
    </div>
  )
}
