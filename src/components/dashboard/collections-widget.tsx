'use client'

import Link from 'next/link'
import { Folder } from 'lucide-react'
import { CollectionsGrid } from '@/components/collections/collections-grid'
import { DashboardWidget } from '@/components/dashboard/dashboard-widget'
import type { CollectionWithTypes } from '@/types/collection'

interface CollectionsWidgetProps {
  collections: CollectionWithTypes[]
}

// Hoisted module-level constant, not created per-render: the link has no dependency on props/state,
// so a single shared element instance is created once ever rather than a fresh one on every render.
const VIEW_ALL_LINK = (
  <Link
    href="/collections"
    prefetch={false}
    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
  >
    View all
  </Link>
)

export function CollectionsWidget({ collections }: CollectionsWidgetProps) {
  return (
    <DashboardWidget icon={Folder} title="Collections" headerAction={VIEW_ALL_LINK}>
      <CollectionsGrid collections={collections} />
    </DashboardWidget>
  )
}
