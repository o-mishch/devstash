import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Folder } from 'lucide-react'
import type { CollectionWithTypes } from '@/client'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'

interface CollectionsWidgetProps {
  collections: CollectionWithTypes[]
  isPending: boolean
  isError: boolean
}

const VIEW_ALL_LINK = (
  <Link
    to="/collections"
    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
  >
    View all
  </Link>
)

/** Dashboard "Collections" section — the shared collections grid inside a collapsible widget. */
export function CollectionsWidget({
  collections,
  isPending,
  isError,
}: CollectionsWidgetProps): ReactNode {
  return (
    <DashboardWidget icon={Folder} title="Collections" headerAction={VIEW_ALL_LINK}>
      <CollectionsGrid
        data={collections}
        isPending={isPending}
        isError={isError}
        skeletonCount={3}
        emptyDescription="Group related items into collections to keep things tidy."
      />
    </DashboardWidget>
  )
}
