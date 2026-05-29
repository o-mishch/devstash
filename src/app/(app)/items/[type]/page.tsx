import { notFound } from 'next/navigation'
import { getCurrentUserId } from '@/lib/session'
import { getItemTypeBySlug, getItemsByType } from '@/lib/db/items'
import { fetchSidebarData } from '@/lib/db/sidebar'
import { getTypeLabel } from '@/lib/utils'
import { ItemsGrid } from './_components/items-grid'
import { CreateItemDialog } from '@/components/items/item-create-dialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

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

  const [{ itemTypes, collections }, items] = await Promise.all([
    fetchSidebarData(userId, null),
    userId ? getItemsByType(userId, itemType.name) : Promise.resolve([]),
  ])

  const label = getTypeLabel(itemType.name)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{label}</h1>
          <p className="text-sm text-muted-foreground capitalize">{itemType.name}s • {items.length}</p>
        </div>
        <CreateItemDialog 
          itemTypes={itemTypes} 
          collections={collections}
          initialType={itemType.name} 
          trigger={<Button size="sm"><Plus className="size-4 mr-1" /> Add {label}</Button>} 
        />
      </div>

      <ItemsGrid items={items} typeName={itemType.name} />
    </div>
  )
}
