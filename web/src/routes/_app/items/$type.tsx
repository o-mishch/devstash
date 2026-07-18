import type { ReactNode } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PackageOpen } from 'lucide-react'
import { itemCount, useItemsInfinite } from '@/hooks/use-items'
import { itemTypeMeta } from '@/lib/item-types'
import { PageHeader } from '@/components/app/page-header'
import { ItemList } from '@/components/items/item-list'

export const Route = createFileRoute('/_app/items/$type')({
  beforeLoad: ({ params }) => {
    // Unknown type name → 404 (handled by the router's notFoundComponent).
    if (!itemTypeMeta(params.type)) throw notFound()
  },
  component: ItemsByType,
})

function ItemsByType(): ReactNode {
  const { type } = Route.useParams()
  const meta = itemTypeMeta(type)
  const items = useItemsInfinite({ type: 'type', typeName: type })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={meta?.icon}
        iconClassName={meta?.accent}
        title={meta?.plural ?? type}
        count={itemCount(items)}
      />
      <ItemList
        query={items}
        empty={{
          icon: meta?.icon ?? PackageOpen,
          title: `No ${meta?.plural.toLowerCase() ?? 'items'} yet`,
          description:
            meta?.pro === true
              ? 'File and image items arrive with uploads in a later release.'
              : undefined,
        }}
      />
    </div>
  )
}
