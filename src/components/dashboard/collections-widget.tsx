'use client'

import Link from 'next/link'
import { Folder } from 'lucide-react'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionsWidgetProps {
  collections: CollectionWithTypes[]
}

export function CollectionsWidget({ collections }: CollectionsWidgetProps) {
  return (
    <DashboardWidget
      icon={Folder}
      title="Collections"
      headerAction={
        <Link
          href="/collections"
          prefetch={false}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
        </Link>
      }
    >
      <CollectionsGrid collections={collections} />
    </DashboardWidget>
  )
}
